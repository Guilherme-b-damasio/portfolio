import { createSocket } from "node:dgram";
import { afterEach, describe, expect, it } from "vitest";
import { InMemoryNatBindings } from "../src/infrastructure/stun/in-memory-bindings.js";
import {
  ATTR,
  CLASS,
  findAttribute,
  HEADER_BYTES,
  parseMessage,
  readXorMappedAddress,
  writeMessage,
} from "../src/infrastructure/stun/message.js";
import { StunServer } from "../src/infrastructure/stun/stun-server.js";

const TRANSACTION = Buffer.from("b7e7a701bc34d686fa87dfae", "hex");

function request(attributes: { type: number; value: Buffer }[] = [], transactionId: Buffer = TRANSACTION): Buffer {
  return writeMessage({ class: CLASS.REQUEST, transactionId, attributes, fingerprint: false });
}

describe("nat bindings", () => {
  it("keeps one entry per reflexive port and socket, up to its cap, and forgets them when they expire", () => {
    let clock = 1_000_000;
    const bindings = new InMemoryNatBindings({ ttlMs: 60_000, maxAddresses: 2, maxPerAddress: 2 }, () => clock);
    const sighting = { address: "203.0.113.9", port: 54321, serverPort: 3478, software: null };
    bindings.record(sighting);
    bindings.record({ ...sighting, software: "navegador" }); // a retry: the same mapping, with more detail
    bindings.record({ ...sighting, serverPort: 3479 });
    bindings.record({ ...sighting, port: 54322 }); // past maxPerAddress
    expect(bindings.forAddress("203.0.113.9")).toEqual([
      { ...sighting, software: "navegador", at: new Date(clock).toISOString() },
      { ...sighting, serverPort: 3479, at: new Date(clock).toISOString() },
    ]);
    expect(bindings.forAddress("198.51.100.1")).toEqual([]);

    bindings.record({ ...sighting, address: "198.51.100.1" });
    bindings.record({ ...sighting, address: "198.51.100.2" }); // past maxAddresses
    expect(bindings.live).toBe(2);
    expect(bindings.forAddress("198.51.100.2")).toEqual([]);

    clock += 60_001;
    expect(bindings.forAddress("203.0.113.9")).toEqual([]);
    expect(bindings.live).toBe(0);
  });
});

describe("stun server", () => {
  const started: StunServer[] = [];
  afterEach(async () => {
    await Promise.all(started.splice(0).map((s) => s.close()));
  });

  function setup(limits = {}) {
    let clock = 1_000_000;
    const bindings = new InMemoryNatBindings({}, () => clock);
    const server = new StunServer(bindings, limits, () => clock);
    return { bindings, server, tick: (ms: number) => (clock += ms) };
  }

  it("tells the client the address and port it was seen from", async () => {
    const { bindings, server } = setup();
    const port = await server.listen(0, "127.0.0.1");
    started.push(server);

    const client = createSocket("udp4");
    const reply = await new Promise<Buffer>((resolve, reject) => {
      client.once("message", resolve);
      client.once("error", reject);
      client.send(request(), port, "127.0.0.1");
    });
    const clientPort = client.address().port;
    client.close();

    const message = parseMessage(reply);
    expect(message.class).toBe(CLASS.SUCCESS);
    expect(message.transactionId.toString("hex")).toBe(TRANSACTION.toString("hex"));
    expect(readXorMappedAddress(findAttribute(message, ATTR.XOR_MAPPED_ADDRESS)!, TRANSACTION)).toEqual({
      address: "127.0.0.1",
      port: clientPort,
    });
    expect(findAttribute(message, ATTR.FINGERPRINT)).not.toBeNull();
    expect(bindings.forAddress("127.0.0.1")).toEqual([
      { address: "127.0.0.1", port: clientPort, serverPort: port, software: null, at: expect.any(String) },
    ]);
  });

  it("points at the other socket of the pair, so the client can compare the two mappings", () => {
    const { server } = setup();
    server.other = { address: "198.51.100.5", port: 3479 };
    const origin = { address: "198.51.100.5", port: 3478 };
    const message = parseMessage(server.respond(request(), { address: "203.0.113.9", port: 1234 }, origin)!);
    expect(findAttribute(message, ATTR.RESPONSE_ORIGIN)!.readUInt16BE(2)).toBe(3478);
    expect(findAttribute(message, ATTR.OTHER_ADDRESS)!.readUInt16BE(2)).toBe(3479);
  });

  it("stays silent on anything that is not a binding request", () => {
    const { server, bindings } = setup();
    const from = { address: "203.0.113.9", port: 1234 };
    const origin = { address: "198.51.100.5", port: 3478 };
    expect(server.respond(Buffer.from("GET / HTTP/1.1\r\n\r\n"), from, origin)).toBeNull();
    expect(
      server.respond(writeMessage({ class: CLASS.SUCCESS, transactionId: TRANSACTION, attributes: [] }), from, origin),
    ).toBeNull();
    expect(server.stats.ignored).toBe(2);
    expect(bindings.forAddress("203.0.113.9")).toEqual([]);
  });

  it("answers 420 when a comprehension-required attribute is one it does not know", () => {
    const { server, bindings } = setup();
    const odd = [{ type: 0x0ff0, value: Buffer.alloc(4) }];
    const reply = server.respond(request(odd), { address: "203.0.113.9", port: 1234 }, null)!;
    const message = parseMessage(reply);
    expect(message.class).toBe(CLASS.ERROR);
    const error = findAttribute(message, ATTR.ERROR_CODE)!;
    expect([error[2], error[3]]).toEqual([4, 20]);
    expect(findAttribute(message, ATTR.UNKNOWN_ATTRIBUTES)!.readUInt16BE(0)).toBe(0x0ff0);
    expect(bindings.forAddress("203.0.113.9")).toEqual([]);
  });

  it("drops oversized datagrams and everything past the ceiling, and lets the next second through", () => {
    const { server, tick } = setup({ maxRequestsPerSecond: 1, maxPacketBytes: 64 });
    const from = { address: "203.0.113.9", port: 1234 };
    expect(server.respond(Buffer.alloc(128), from, null)).toBeNull();
    expect(server.respond(request(), from, null)).not.toBeNull();
    expect(server.respond(request(), from, null)).toBeNull();
    expect(server.stats.dropped).toBe(2);
    tick(1_000);
    expect(server.respond(request(), from, null)).not.toBeNull();
  });

  it("answers with little more than it was asked, so the port is no amplifier", () => {
    const { server } = setup();
    const ask = request();
    const reply = server.respond(ask, { address: "203.0.113.9", port: 1234 }, { address: "198.51.100.5", port: 3478 })!;
    expect(ask.length).toBe(HEADER_BYTES);
    expect(reply.length).toBeLessThanOrEqual(ask.length * 3);
  });
});
