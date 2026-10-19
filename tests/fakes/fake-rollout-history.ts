import { ClusterUnavailable } from "../../src/domain/cluster.js";
import type { RolloutHistory, RolloutView } from "../../src/domain/delivery.js";

export const fakeRollout: RolloutView = {
  revision: 5,
  image: "ghcr.io/guilherme-b-damasio/portfolio:20261017171853-9eae1df",
  sha: "9eae1df",
  startedAt: "2026-10-17T17:21:04Z",
  readyAt: "2026-10-17T17:21:19Z",
  replicas: "1/1",
  current: true,
};

/** In-memory rollout history for tests: counts reads and can be switched off. */
export class FakeRolloutHistory implements RolloutHistory {
  calls = 0;
  down = false;

  constructor(private readonly views: RolloutView[] = [fakeRollout]) {}

  async rollouts(): Promise<RolloutView[]> {
    this.calls++;
    if (this.down) throw new ClusterUnavailable("a API do cluster está fora de alcance");
    return this.views;
  }
}
