import { describe, expect, it } from "vitest";
import { TraceDeploys } from "../src/application/trace-deploys.js";
import type { BuildView, RolloutView } from "../src/domain/delivery.js";
import { FakeBuildHistory, fakeBuild } from "./fakes/fake-build-history.js";
import { FakeRolloutHistory, fakeRollout } from "./fakes/fake-rollout-history.js";

const running: BuildView = {
  ...fakeBuild,
  sha: "c".repeat(40),
  message: "feat: something new",
  status: "running",
  finishedAt: null,
};
const older: RolloutView = {
  ...fakeRollout,
  revision: 4,
  sha: "a3b3c7a",
  image: "ghcr.io/x/portfolio:20261017141907-a3b3c7a",
  readyAt: null,
  replicas: "0/0",
  current: false,
};

describe("TraceDeploys", () => {
  it("meets each build with the rollout of its image, newest first", async () => {
    const trace = new TraceDeploys(
      new FakeBuildHistory([running, fakeBuild]),
      new FakeRolloutHistory([fakeRollout, older]),
    );
    const { deploys, sources } = await trace.timeline();
    expect(sources).toEqual({ github: { state: "ok" }, cluster: { state: "ok" } });
    expect(deploys.map((d) => d.sha)).toEqual(["c".repeat(40), fakeBuild.sha, "a3b3c7a"]);

    // Still building: no rollout yet.
    expect(deploys[0]).toMatchObject({ message: "feat: something new", rollout: null, build: { status: "running" } });
    // Built and running in the cluster.
    expect(deploys[1]).toEqual({
      sha: fakeBuild.sha,
      message: fakeBuild.message,
      author: fakeBuild.author,
      committedAt: fakeBuild.committedAt,
      build: {
        status: "success",
        startedAt: fakeBuild.startedAt,
        finishedAt: fakeBuild.finishedAt,
        url: fakeBuild.url,
      },
      rollout: {
        revision: 5,
        image: fakeRollout.image,
        startedAt: fakeRollout.startedAt,
        readyAt: fakeRollout.readyAt,
        replicas: "1/1",
        current: true,
      },
    });
    // A revision older than every build GitHub lists still shows up, without a commit.
    expect(deploys[2]).toMatchObject({ message: null, build: null, rollout: { revision: 4 } });
  });

  it("keeps showing one source when the other fails", async () => {
    const builds = new FakeBuildHistory();
    const rollouts = new FakeRolloutHistory();
    rollouts.down = true;
    const outsideCluster = await new TraceDeploys(builds, rollouts).timeline();
    expect(outsideCluster.sources.cluster).toEqual({
      state: "unavailable",
      error: "a API do cluster está fora de alcance",
    });
    expect(outsideCluster.deploys).toEqual([expect.objectContaining({ sha: fakeBuild.sha, rollout: null })]);

    builds.down = true;
    rollouts.down = false;
    const noGitHub = await new TraceDeploys(builds, rollouts).timeline();
    expect(noGitHub.sources.github).toMatchObject({ state: "unavailable", error: expect.stringMatching(/GitHub/) });
    expect(noGitHub.deploys).toEqual([expect.objectContaining({ sha: "9eae1df", build: null })]);
  });

  it("says which sources are off and never leaks an unexpected error", async () => {
    const broken = { builds: async () => Promise.reject(new Error("ECONNREFUSED 10.0.0.1")) };
    const { deploys, sources } = await new TraceDeploys(broken, null).timeline();
    expect(deploys).toEqual([]);
    expect(sources).toEqual({
      github: { state: "unavailable", error: "falhou ao ler esta fonte" },
      cluster: { state: "off" },
    });
  });

  it("caps the timeline at ten deploys", async () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ ...fakeBuild, sha: i.toString(16).padStart(40, "0") }));
    const { deploys } = await new TraceDeploys(new FakeBuildHistory(many), null).timeline();
    expect(deploys).toHaveLength(10);
  });
});
