import { describe, expect, it } from "vitest";
import { ClusterUnavailable } from "../src/domain/cluster.js";
import { FluxTagSelectionHistory } from "../src/infrastructure/cluster/flux-tag-selection-history.js";
import { KubeApiError, type KubeGet } from "../src/infrastructure/cluster/kubernetes-cluster-reader.js";

// Trimmed core/v1 events in the shape the API server answers for an ImagePolicy.
const repo = "ghcr.io/guilherme-b-damasio/portfolio";
const event = (message: string, at: Partial<Record<"firstTimestamp" | "eventTime" | "created", string>>) => ({
  metadata: { name: `portfolio.${Math.random()}`, creationTimestamp: at.created ?? null },
  involvedObject: { kind: "ImagePolicy", name: "portfolio", namespace: "flux-system" },
  reason: "Succeeded",
  type: "Normal",
  message,
  firstTimestamp: at.firstTimestamp ?? null,
  eventTime: at.eventTime ?? null,
  count: 1,
});
const list = {
  items: [
    event(`Latest image tag for '${repo}' resolved to 20261017141907-a3b3c7a`, {
      firstTimestamp: "2026-10-17T14:20:30Z",
    }),
    event(`Latest image tag for '${repo}' updated from 20261017141907-a3b3c7a to 20261017171853-9eae1df`, {
      firstTimestamp: "2026-10-17T17:20:41Z",
    }),
    // Resolved again after a controller restart: the first time the tag was picked still counts.
    event(`Latest image tag for '${repo}' resolved to 20261017171853-9eae1df`, {
      eventTime: "2026-10-17T18:00:00.000000Z",
    }),
    event(`Latest image tag for '${repo}' resolved to latest`, { created: "2026-10-16T00:00:00Z" }),
    event("reconciliation failed: auth required", { firstTimestamp: "2026-10-17T19:00:00Z" }),
    event(`Latest image tag for '${repo}' resolved to 20261017000000-abcdef0`, {}),
    { ...event("resolved to 20261017000000-1234567", { firstTimestamp: "2026-10-17T20:00:00Z" }), involvedObject: {} },
  ],
};

function fakeApi(body: unknown) {
  const calls: string[] = [];
  const get: KubeGet = async (path) => {
    calls.push(path);
    if (body instanceof Error) throw body;
    return body;
  };
  return { get, calls };
}

const options = { namespace: "flux-system", policy: "portfolio" };

describe("FluxTagSelectionHistory", () => {
  it("reads when each tag was picked from the policy's events, newest first", async () => {
    const { get, calls } = fakeApi(list);
    const selections = await new FluxTagSelectionHistory(get, options).selections();
    expect(calls).toEqual([
      "/api/v1/namespaces/flux-system/events?fieldSelector=involvedObject.kind%3DImagePolicy%2CinvolvedObject.name%3Dportfolio&limit=100",
    ]);
    expect(selections).toEqual([
      { tag: "20261017171853-9eae1df", sha: "9eae1df", selectedAt: "2026-10-17T17:20:41Z" },
      { tag: "20261017141907-a3b3c7a", sha: "a3b3c7a", selectedAt: "2026-10-17T14:20:30Z" },
      { tag: "latest", sha: null, selectedAt: "2026-10-16T00:00:00Z" },
    ]);
  });

  it("answers nothing when the events have expired", async () => {
    const { get } = fakeApi({ items: [] });
    expect(await new FluxTagSelectionHistory(get, options).selections()).toEqual([]);
  });

  it("refuses names that could bend the API path", () => {
    const { get } = fakeApi(list);
    expect(() => new FluxTagSelectionHistory(get, { ...options, namespace: "../secrets" })).toThrow();
    expect(() => new FluxTagSelectionHistory(get, { ...options, policy: "a,involvedObject.kind=Secret" })).toThrow();
  });

  it("says RBAC is missing when the Role does not cover events in the Flux namespace", async () => {
    const { get } = fakeApi(new KubeApiError(403, "x"));
    await expect(new FluxTagSelectionHistory(get, options).selections()).rejects.toThrow(
      new ClusterUnavailable("o cluster recusou a leitura: falta permissão (RBAC)"),
    );
  });
});
