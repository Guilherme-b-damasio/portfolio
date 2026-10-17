import { mkdtempSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inClusterGet, kubeGet } from "../src/infrastructure/cluster/in-cluster-get.js";
import { KubeApiError } from "../src/infrastructure/cluster/kubernetes-cluster-reader.js";

// A local stand-in for the API server: plain HTTP, so the transport is tested without a cluster.
const seen: http.IncomingHttpHeaders[] = [];
const server = http.createServer((req, res) => {
  seen.push(req.headers);
  if (req.url === "/api/v1/nodes") return res.end(JSON.stringify({ items: [] }));
  if (req.url === "/big") return res.end("x".repeat(5_000));
  if (req.url === "/slow") return; // never answers
  res.statusCode = 403;
  res.end(JSON.stringify({ kind: "Status", reason: "Forbidden" }));
});
let baseUrl = "";

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.closeAllConnections();
  server.close();
});

describe("kubeGet", () => {
  const signal = () => AbortSignal.timeout(2_000);

  it("sends the current token and parses the JSON answer", async () => {
    let token = "first";
    const get = kubeGet({ baseUrl, token: () => token });
    expect(await get("/api/v1/nodes", signal())).toEqual({ items: [] });
    token = "rotated";
    await get("/api/v1/nodes", signal());
    expect(seen.slice(-2).map((h) => h.authorization)).toEqual(["Bearer first", "Bearer rotated"]);
  });

  it("turns a non-2xx into a KubeApiError with the status", async () => {
    const err = await kubeGet({ baseUrl, token: () => "t" })("/api/v1/secrets", signal()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KubeApiError);
    expect((err as KubeApiError).status).toBe(403);
  });

  it("cuts off answers past the size cap", async () => {
    await expect(kubeGet({ baseUrl, token: () => "t", maxBytes: 1_000 })("/big", signal())).rejects.toThrow(
      /acima de 1000 bytes/,
    );
  });

  it("stops waiting when the signal fires", async () => {
    const err = await kubeGet({ baseUrl, token: () => "t" })("/slow", AbortSignal.timeout(30)).catch((e: Error) => e);
    expect((err as Error).name).toBe("TimeoutError");
  });
});

describe("inClusterGet", () => {
  it("is off outside a pod", () => {
    expect(inClusterGet({}, path.join(tmpdir(), "no-such-service-account"))).toBeNull();
  });

  it("is on with the service host and a mounted service account", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "sa-"));
    writeFileSync(path.join(dir, "ca.crt"), "not a real cert");
    writeFileSync(path.join(dir, "token"), "token\n");
    expect(inClusterGet({}, dir)).toBeNull();
    expect(inClusterGet({ KUBERNETES_SERVICE_HOST: "10.43.0.1" }, dir)).toBeTypeOf("function");
  });
});
