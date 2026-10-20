import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { AskQuestion } from "../src/application/ask-question.js";
import { BrowsePortfolio } from "../src/application/browse-portfolio.js";
import { InspectVisitor } from "../src/application/inspect-visitor.js";
import { ReportStatus } from "../src/application/report-status.js";
import { SendContact } from "../src/application/send-contact.js";
import { TraceDeploys } from "../src/application/trace-deploys.js";
import type { Content } from "../src/domain/content.js";
import { createApp } from "../src/http/app.js";
import { CachedRolloutHistory } from "../src/infrastructure/cluster/cached-rollout-history.js";
import { CachedTagSelectionHistory } from "../src/infrastructure/cluster/cached-tag-selection-history.js";
import { InMemoryMetrics } from "../src/infrastructure/metrics/in-memory-metrics.js";
import { SampledHistory } from "../src/infrastructure/metrics/sampled-history.js";
import { FakeBuildHistory, fakeBuild } from "./fakes/fake-build-history.js";
import { FakeRolloutHistory } from "./fakes/fake-rollout-history.js";
import { FakeTagSelectionHistory, fakeSelection } from "./fakes/fake-tag-selection-history.js";

let server: Server | null = null;
afterEach(() => server?.close());

async function serve(traceDeploys: TraceDeploys | null) {
  const metrics = new InMemoryMetrics();
  const content: Content = { profile: { name: "n", role: "r", body: "" }, projects: [], skills: [] } as never;
  const app = createApp({
    browse: new BrowsePortfolio(content),
    askQuestion: new AskQuestion({ search: () => [] }, null),
    reportStatus: new ReportStatus(metrics, null, new SampledHistory(metrics)),
    sendContact: new SendContact(null),
    inspectVisitor: new InspectVisitor([], { lookup: async () => null }),
    traceDeploys,
    metrics,
    logger: { info: () => {}, error: () => {} },
    publicDir: path.resolve(import.meta.dirname, "..", "public"),
  });
  server = app.listen(0);
  await new Promise((resolve) => server!.once("listening", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/deploys`;
}

describe("/api/deploys", () => {
  it("serves the joined timeline with the state of each source", async () => {
    const url = await serve(
      new TraceDeploys(new FakeBuildHistory(), new FakeRolloutHistory(), new FakeTagSelectionHistory()),
    );
    const res = await fetch(url);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sources).toEqual({ github: { state: "ok" }, cluster: { state: "ok" }, flux: { state: "ok" } });
    expect(body.deploys[0]).toMatchObject({
      sha: fakeBuild.sha,
      build: { status: "success" },
      selectedAt: fakeSelection.selectedAt,
      rollout: { revision: 5 },
    });
    expect(typeof body.readAt).toBe("string");
  });

  it("still answers 200 outside a cluster, saying the cluster is off", async () => {
    const url = await serve(new TraceDeploys(new FakeBuildHistory(), null));
    const body = await (await fetch(url)).json();
    expect(body.sources.cluster).toEqual({ state: "off" });
    expect(body.deploys).toHaveLength(1);
  });

  it("answers 503 when the timeline is not wired", async () => {
    const res = await fetch(await serve(null));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ off: true });
  });

  it("reads the cluster once per window however many visitors ask", async () => {
    const rollouts = new FakeRolloutHistory();
    const url = await serve(new TraceDeploys(null, new CachedRolloutHistory(rollouts)));
    await Promise.all(Array.from({ length: 10 }, () => fetch(url).then((r) => r.json())));
    expect(rollouts.calls).toBe(1);
  });

  it("reads the Flux events once per window too", async () => {
    const selections = new FakeTagSelectionHistory();
    const url = await serve(new TraceDeploys(null, null, new CachedTagSelectionHistory(selections)));
    await Promise.all(Array.from({ length: 10 }, () => fetch(url).then((r) => r.json())));
    expect(selections.calls).toBe(1);
  });
});
