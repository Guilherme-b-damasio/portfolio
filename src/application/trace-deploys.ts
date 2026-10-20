import { ClusterUnavailable } from "../domain/cluster.js";
import {
  type BuildHistory,
  type BuildView,
  DeliveryUnavailable,
  type RolloutHistory,
  type RolloutView,
  type TagSelectionHistory,
  type TagSelectionView,
} from "../domain/delivery.js";

/** One change on its way to production: the commit, the image built from it and the rollout that ran it. */
export interface DeployView {
  sha: string; // the full sha when GitHub knows the build, else the short one from the image tag
  message: string | null;
  author: string | null;
  committedAt: string | null;
  build: Omit<BuildView, "sha" | "message" | "author" | "committedAt"> | null;
  selectedAt: string | null; // when Flux's ImagePolicy picked the image's tag; null once the event expired
  rollout: Omit<RolloutView, "sha"> | null; // null until Flux applies the image, or for builds that never ship
}

/** Whether a source answered. `off` is not configured here; `unavailable` failed this time. */
export type SourceState = { state: "ok" } | { state: "off" } | { state: "unavailable"; error: string };

export interface DeployTimeline {
  deploys: DeployView[];
  sources: { github: SourceState; cluster: SourceState; flux: SourceState };
}

const MAX_DEPLOYS = 10;

/**
 * The `deploys` timeline: commit → image build (GitHub Actions) → tag picked (Flux's ImagePolicy) →
 * rollout (the ReplicaSet Flux's change created) → pod Ready. The sources meet on the sha in the image
 * tag. Each one can fail on its own and the timeline still shows what the others know.
 */
export class TraceDeploys {
  constructor(
    private readonly builds: BuildHistory | null,
    private readonly rollouts: RolloutHistory | null,
    private readonly selections: TagSelectionHistory | null = null,
  ) {}

  async timeline(): Promise<DeployTimeline> {
    const [github, cluster, flux] = await Promise.all([
      settle(this.builds, (b) => b.builds()),
      settle(this.rollouts, (r) => r.rollouts()),
      settle(this.selections, (s) => s.selections()),
    ]);
    const builds = github.value ?? [];
    const rollouts = cluster.value ?? [];
    const selections = flux.value ?? [];
    const selectedAt = (match: (s: TagSelectionView) => boolean) => selections.find(match)?.selectedAt ?? null;

    const matched = new Set<RolloutView>();
    const deploys: DeployView[] = builds.map(({ sha, message, author, committedAt, ...build }) => {
      // A sha can be rolled out more than once (a rollback); the newest revision is the one that counts.
      const rollout = rollouts.find((r) => r.sha !== null && sha.startsWith(r.sha));
      if (rollout) matched.add(rollout);
      const picked = selectedAt((s) => s.sha !== null && sha.startsWith(s.sha));
      return {
        sha,
        message,
        author,
        committedAt,
        build,
        selectedAt: picked,
        rollout: rollout ? withoutSha(rollout) : null,
      };
    });
    // Revisions older than the builds GitHub lists, or with a tag that names no commit.
    for (const rollout of rollouts) {
      if (matched.has(rollout)) continue;
      deploys.push({
        sha: rollout.sha ?? "",
        message: null,
        author: null,
        committedAt: null,
        build: null,
        selectedAt: selectedAt((s) => rollout.image.endsWith(`:${s.tag}`)),
        rollout: withoutSha(rollout),
      });
    }
    return {
      deploys: deploys.slice(0, MAX_DEPLOYS),
      sources: { github: github.source, cluster: cluster.source, flux: flux.source },
    };
  }
}

async function settle<S, T>(source: S | null, read: (s: S) => Promise<T>): Promise<{ value?: T; source: SourceState }> {
  if (!source) return { source: { state: "off" } };
  try {
    return { value: await read(source), source: { state: "ok" } };
  } catch (err) {
    // Only the sources' own errors are written for the visitor; anything else stays on the server.
    const safe = err instanceof DeliveryUnavailable || err instanceof ClusterUnavailable;
    return { source: { state: "unavailable", error: safe ? err.message : "falhou ao ler esta fonte" } };
  }
}

function withoutSha({ sha: _sha, ...rest }: RolloutView): Omit<RolloutView, "sha"> {
  return rest;
}
