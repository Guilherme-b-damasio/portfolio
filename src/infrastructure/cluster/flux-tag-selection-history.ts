import { z } from "zod";
import type { TagSelectionHistory, TagSelectionView } from "../../domain/delivery.js";
import { type KubeGet, readKube } from "./kubernetes-cluster-reader.js";

const events = z.object({
  items: z.array(
    z.object({
      metadata: z.object({ creationTimestamp: z.string().nullish() }),
      involvedObject: z.object({ kind: z.string().nullish(), name: z.string().nullish() }),
      message: z.string().nullish(),
      firstTimestamp: z.string().nullish(),
      eventTime: z.string().nullish(),
    }),
  ),
});

const NAME = /^[a-z0-9]([-a-z0-9.]{0,251}[a-z0-9])?$/;
// What image-reflector-controller says when the policy picks a tag:
//   Latest image tag for 'ghcr.io/x/portfolio' resolved to 20261017171853-9eae1df
//   Latest image tag for 'ghcr.io/x/portfolio' updated from 20261017141907-a3b3c7a to 20261017171853-9eae1df
const SELECTED = /\b(?:resolved to|updated from \S+ to):?\s+'?([A-Za-z0-9_][A-Za-z0-9_.-]{0,127})/;
const TAG = /^\d{14}-([0-9a-f]{7,40})$/;
const LIST_LIMIT = 100;
const MAX_SELECTIONS = 20;

export interface FluxTagSelectionHistoryOptions {
  namespace: string; // where the ImagePolicy lives, usually flux-system
  policy: string; // the ImagePolicy that picks this app's tag
  timeoutMs?: number;
}

/**
 * Reads when Flux picked each tag from the ImagePolicy's events: one GET of core/v1 events in the
 * Flux namespace, filtered on the server to that one policy. The API server drops events after its
 * `--event-ttl` (an hour by default), so only recent deploys get this stage.
 */
export class FluxTagSelectionHistory implements TagSelectionHistory {
  private readonly path: string;
  private readonly timeoutMs: number;

  constructor(
    private readonly get: KubeGet,
    { namespace, policy, timeoutMs = 3_000 }: FluxTagSelectionHistoryOptions,
  ) {
    if (!NAME.test(namespace) || !NAME.test(policy)) throw new Error("namespace ou ImagePolicy inválido");
    const query = new URLSearchParams({
      fieldSelector: `involvedObject.kind=ImagePolicy,involvedObject.name=${policy}`,
      limit: String(LIST_LIMIT),
    });
    this.path = `/api/v1/namespaces/${namespace}/events?${query}`;
    this.timeoutMs = timeoutMs;
  }

  async selections(): Promise<TagSelectionView[]> {
    const list = await readKube(this.get, this.path, events, this.timeoutMs);
    // A tag can be named by more than one event (picked, then resolved again on a restart); the first one counts.
    const first = new Map<string, string>();
    for (const event of list.items) {
      if (event.involvedObject.kind !== "ImagePolicy") continue;
      const tag = SELECTED.exec(event.message ?? "")?.[1];
      const at = event.firstTimestamp ?? event.eventTime ?? event.metadata.creationTimestamp;
      if (!tag || !at || Number.isNaN(Date.parse(at))) continue;
      const seen = first.get(tag);
      if (!seen || Date.parse(at) < Date.parse(seen)) first.set(tag, at);
    }
    return [...first]
      .map(([tag, selectedAt]) => ({ tag, sha: TAG.exec(tag)?.[1] ?? null, selectedAt }))
      .sort((a, b) => Date.parse(b.selectedAt) - Date.parse(a.selectedAt))
      .slice(0, MAX_SELECTIONS);
  }
}
