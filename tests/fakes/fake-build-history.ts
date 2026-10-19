import { type BuildHistory, type BuildView, DeliveryUnavailable } from "../../src/domain/delivery.js";

export const fakeBuild: BuildView = {
  sha: "9eae1df79a0a8a1f229653b56038e0f5ca9f929b",
  message: "Merge branch 'feature/rbac-manifests' into develop",
  author: "Guilherme-b-damasio",
  committedAt: "2026-10-17T17:18:16Z",
  status: "success",
  startedAt: "2026-10-17T17:18:53Z",
  finishedAt: "2026-10-17T17:19:39Z",
  url: "https://github.com/o/r/actions/runs/2",
};

/** In-memory build history for tests: counts reads and can be switched off. */
export class FakeBuildHistory implements BuildHistory {
  calls = 0;
  down = false;

  constructor(private readonly views: BuildView[] = [fakeBuild]) {}

  async builds(): Promise<BuildView[]> {
    this.calls++;
    if (this.down) throw new DeliveryUnavailable("a API do GitHub está fora de alcance");
    return this.views;
  }
}
