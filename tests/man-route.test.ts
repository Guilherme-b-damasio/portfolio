import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DescribeCommands } from "../src/application/describe-commands.js";
import { StaticManualLibrary } from "../src/infrastructure/manual/static-manual-library.js";
import { WiredCapabilities } from "../src/infrastructure/manual/wired-capabilities.js";
import { manRouter } from "../src/http/routes/man.js";
import { TokenBucket } from "../src/http/middleware/rate-limit.js";

// Only the LLM and the trace buffer are wired here: the other commands' pages must say they are off.
const manual = () =>
  new DescribeCommands(new StaticManualLibrary(), new WiredCapabilities({ llm: true, traces: true }));

const serve = async (bucket?: TokenBucket) => {
  const app = express();
  app.use("/api/man", bucket ? manRouter(manual(), bucket) : manRouter(manual()));
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return { server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
};

let server: Server;
let base: string;

beforeAll(async () => {
  ({ server, base } = await serve());
});

afterAll(() => server.close());

describe("GET /api/man", () => {
  it("lists the pages with the commands this server can answer", async () => {
    const res = await fetch(`${base}/api/man`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    const { commands } = await res.json();
    expect(commands.find((c: { name: string }) => c.name === "ask")).toMatchObject({ available: true });
    // The STUN sockets are not listening in this test, so its page says so instead of inviting the visitor.
    expect(commands.find((c: { name: string }) => c.name === "stun")).toMatchObject({ available: false });
  });

  it("returns one page, with the reason a command is off here", async () => {
    const ask = await (await fetch(`${base}/api/man/ask`)).json();
    expect(ask).toMatchObject({ name: "ask", available: true, off: null });
    expect(ask.options.map((o: { flag: string }) => o.flag)).toContain("--xray");

    const stun = await (await fetch(`${base}/api/man/stun`)).json();
    expect(stun).toMatchObject({ name: "stun", available: false });
    expect(stun.off).toMatch(/UDP/);
  });

  it("404s for a command with no page, echoing nothing long back", async () => {
    const res = await fetch(`${base}/api/man/${encodeURIComponent("rm -rf /".repeat(20))}`);
    expect(res.status).toBe(404);
    const { error } = await res.json();
    expect(error.length).toBeLessThan(80);
  });

  it("limits reads with a bucket", async () => {
    const own = await serve(new TokenBucket(2, 60));
    try {
      const statuses = [];
      for (let i = 0; i < 4; i++) statuses.push((await fetch(`${own.base}/api/man/help`)).status);
      expect(statuses).toEqual([200, 200, 429, 429]);
    } finally {
      own.server.close();
    }
  });
});
