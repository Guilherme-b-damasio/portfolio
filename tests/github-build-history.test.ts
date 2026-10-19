import { describe, expect, it } from "vitest";
import { DeliveryUnavailable } from "../src/domain/delivery.js";
import {
  GitHubApiError,
  GitHubBuildHistory,
  type GitHubGet,
  statusOf,
} from "../src/infrastructure/delivery/github-build-history.js";

// Trimmed workflow runs in the shape GET /repos/{repo}/actions/workflows/{file}/runs answers.
const sha = (c: string) => c.repeat(40);
const runs = {
  total_count: 2,
  workflow_runs: [
    {
      id: 2,
      head_sha: sha("b"),
      status: "in_progress",
      conclusion: null,
      created_at: "2026-10-17T17:18:53Z",
      run_started_at: "2026-10-17T17:18:55Z",
      updated_at: "2026-10-17T17:19:20Z",
      html_url: "https://github.com/o/r/actions/runs/2",
      head_commit: {
        message: "Merge branch 'feature/rbac-manifests' into develop\n\nbody",
        timestamp: "2026-10-17T17:18:50Z",
        author: { name: "Guilherme-b-damasio", email: "x@users.noreply.github.com" },
      },
    },
    {
      id: 1,
      head_sha: sha("a"),
      status: "completed",
      conclusion: "success",
      created_at: "2026-10-17T14:03:29Z",
      updated_at: "2026-10-17T14:04:15Z",
      html_url: "https://github.com/o/r/actions/runs/1",
      head_commit: null,
    },
  ],
};

function setup(answer: unknown | Error = runs) {
  const calls: string[] = [];
  const get: GitHubGet = async (url) => {
    calls.push(url);
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { calls, history: new GitHubBuildHistory(get, { repo: "o/r" }) };
}

describe("GitHubBuildHistory", () => {
  it("reads the pushes to develop from the image workflow, one call", async () => {
    const { calls, history } = setup();
    const builds = await history.builds();
    expect(calls).toEqual([
      "https://api.github.com/repos/o/r/actions/workflows/image.yml/runs?branch=develop&event=push&per_page=10",
    ]);
    expect(builds[0]).toEqual({
      sha: sha("b"),
      message: "Merge branch 'feature/rbac-manifests' into develop",
      author: "Guilherme-b-damasio",
      committedAt: "2026-10-17T17:18:50Z",
      status: "running",
      startedAt: "2026-10-17T17:18:55Z",
      finishedAt: null,
      url: "https://github.com/o/r/actions/runs/2",
    });
    expect(builds[1]).toMatchObject({
      status: "success",
      startedAt: "2026-10-17T14:03:29Z",
      finishedAt: "2026-10-17T14:04:15Z",
      author: "?",
      message: "",
      committedAt: null,
    });
  });

  it("caps long commit messages", async () => {
    const long = { workflow_runs: [{ ...runs.workflow_runs[1], head_commit: { message: "x".repeat(500) } }] };
    const [build] = await setup(long).history.builds();
    expect(build.message).toHaveLength(120);
    expect(build.message.endsWith("…")).toBe(true);
  });

  it("refuses repository, workflow and branch names that could bend the URL", () => {
    const get: GitHubGet = async () => runs;
    expect(() => new GitHubBuildHistory(get, { repo: "o/r/../x" })).toThrow();
    expect(() => new GitHubBuildHistory(get, { repo: "o/r", workflow: "../x.yml" })).toThrow();
    expect(() => new GitHubBuildHistory(get, { repo: "o/r", branch: "a&b=c" })).toThrow();
  });

  it("says when GitHub rate-limits this server, without naming it", async () => {
    const err = await setup(new GitHubApiError(403, true, "GET /x: 403"))
      .history.builds()
      .catch((e) => e);
    expect(err).toBeInstanceOf(DeliveryUnavailable);
    expect(err.message).toMatch(/limitou/);
  });

  it("turns timeouts, other failures and unknown shapes into a message safe to show", async () => {
    const timeout = Object.assign(new Error("t"), { name: "TimeoutError" });
    await expect(setup(timeout).history.builds()).rejects.toThrow(/não respondeu em 3000 ms/);
    await expect(setup(new GitHubApiError(500, false, "x")).history.builds()).rejects.toThrow(/fora de alcance/);
    await expect(setup({ nope: true }).history.builds()).rejects.toBeInstanceOf(DeliveryUnavailable);
  });

  it("folds status and conclusion into the five states", () => {
    expect(statusOf("queued", null)).toBe("queued");
    expect(statusOf("waiting", null)).toBe("queued");
    expect(statusOf("in_progress", null)).toBe("running");
    expect(statusOf("completed", "success")).toBe("success");
    expect(statusOf("completed", "cancelled")).toBe("cancelled");
    expect(statusOf("completed", "timed_out")).toBe("failure");
  });
});
