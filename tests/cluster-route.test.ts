import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AskQuestion } from "../src/application/ask-question.js";
import { BrowsePortfolio } from "../src/application/browse-portfolio.js";
import { InspectCluster } from "../src/application/inspect-cluster.js";
import { InspectVisitor } from "../src/application/inspect-visitor.js";
import { ReportStatus } from "../src/application/report-status.js";
import { SendContact } from "../src/application/send-contact.js";
import type { Content } from "../src/domain/content.js";
import { createApp } from "../src/http/app.js";
import { InMemoryMetrics } from "../src/infrastructure/metrics/in-memory-metrics.js";
import { SampledHistory } from "../src/infrastructure/metrics/sampled-history.js";
import { fakeNode, fakePod, FakeClusterReader } from "./fakes/fake-cluster-reader.js";

async function serve(cluster: InspectCluster) {
  const metrics = new InMemoryMetrics();
  const content: Content = { profile: { name: "n", role: "r", body: "" }, projects: [], skills: [] } as never;
  const app = createApp({
    browse: new BrowsePortfolio(content),
    askQuestion: new AskQuestion({ search: () => [] }, null),
    reportStatus: new ReportStatus(metrics, null, new SampledHistory(metrics)),
    sendContact: new SendContact(null),
    inspectVisitor: new InspectVisitor([], { lookup: async () => null }),
    inspectCluster: cluster,
    metrics,
    logger: { info: () => {}, error: () => {} },
    publicDir: path.resolve(import.meta.dirname, "..", "public"),
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/cluster` };
}

describe("/api/cluster", () => {
  const reader = new FakeClusterReader();
  let server: Server;
  let base: string;

  beforeAll(async () => ({ server, base } = await serve(new InspectCluster(reader))));
  afterAll(() => server.close());

  it("answers nodes and pods with the time they were read", async () => {
    const res = await fetch(base);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ namespaces: ["portfolio"], nodes: [fakeNode], pods: [fakePod] });
    expect(Date.parse(body.readAt)).not.toBeNaN();
  });

  it("lists nodes and the pods of a namespace on their own", async () => {
    expect((await (await fetch(`${base}/nodes`)).json()).nodes).toEqual([fakeNode]);
    const pods = await (await fetch(`${base}/pods?namespace=portfolio`)).json();
    expect(pods).toMatchObject({ namespace: "portfolio", pods: [fakePod] });
    expect((await (await fetch(`${base}/pods`)).json()).namespace).toBe("portfolio");
  });

  it("refuses a namespace outside the whitelist and names the visible ones", async () => {
    const res = await fetch(`${base}/pods?namespace=kube-system`);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/kube-system/), namespaces: ["portfolio"] });
  });

  it("answers 503 with Retry-After when the API server is out of reach", async () => {
    reader.down = true;
    try {
      const res = await fetch(base);
      expect(res.status).toBe(503);
      expect(res.headers.get("retry-after")).toBe("10");
      expect((await res.json()).error).toMatch(/fora de alcance/);
    } finally {
      reader.down = false;
    }
  });
});

describe("/api/cluster outside a cluster", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => ({ server, base } = await serve(new InspectCluster(null))));
  afterAll(() => server.close());

  it("says the cluster is off instead of failing", async () => {
    const res = await fetch(`${base}/pods`);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ off: true, error: expect.stringMatching(/cluster/) });
  });
});
