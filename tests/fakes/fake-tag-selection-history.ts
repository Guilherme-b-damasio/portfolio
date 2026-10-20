import { ClusterUnavailable } from "../../src/domain/cluster.js";
import type { TagSelectionHistory, TagSelectionView } from "../../src/domain/delivery.js";

export const fakeSelection: TagSelectionView = {
  tag: "20261017171853-9eae1df",
  sha: "9eae1df",
  selectedAt: "2026-10-17T17:20:41Z",
};

/** In-memory Flux tag selections for tests: counts reads and can be switched off. */
export class FakeTagSelectionHistory implements TagSelectionHistory {
  calls = 0;
  down = false;

  constructor(private readonly views: TagSelectionView[] = [fakeSelection]) {}

  async selections(): Promise<TagSelectionView[]> {
    this.calls++;
    if (this.down) throw new ClusterUnavailable("o cluster recusou a leitura: falta permissão (RBAC)");
    return this.views;
  }
}
