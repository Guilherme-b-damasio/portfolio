export const SIG = [0x0d, 0x0a, 0x0d, 0x0a, 0x00, 0x0d, 0x0a, 0x51, 0x55, 0x49, 0x54, 0x0a];

/** A v2 PROXY header for a TCP client, as Traefik or HAProxy would send it. */
export function proxyV2(client: { address: string; port: number }, tail: Buffer = Buffer.alloc(0)): Buffer {
  const v6 = client.address.includes(":");
  const addresses = Buffer.alloc(v6 ? 36 : 12);
  if (v6) {
    const full = new URL(`http://[${client.address}]/`).hostname.slice(1, -1);
    const [head, rest = ""] = full.split("::");
    const left = head ? head.split(":") : [];
    const right = rest ? rest.split(":") : [];
    const groups = [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
    groups.forEach((g, i) => addresses.writeUInt16BE(parseInt(g, 16), i * 2));
    addresses.writeUInt16BE(client.port, 32);
  } else {
    client.address.split(".").forEach((o, i) => (addresses[i] = Number(o)));
    addresses.writeUInt16BE(client.port, 8);
  }
  const header = Buffer.from([...SIG, 0x21, v6 ? 0x21 : 0x11, 0, 0]);
  header.writeUInt16BE(addresses.length + tail.length, 14);
  return Buffer.concat([header, addresses, tail]);
}
