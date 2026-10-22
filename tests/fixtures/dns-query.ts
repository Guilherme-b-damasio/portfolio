/** Builds a query in wire format, the way a recursive resolver sends one to an authoritative server. */
export function dnsQuery(
  name: string,
  type: number,
  {
    id = 0x1234,
    subnet,
    edns = true,
  }: { id?: number; subnet?: { family: 1 | 2; prefix: number; bytes: number[] }; edns?: boolean } = {},
): Buffer {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(id, 0);
  header.writeUInt16BE(0x0000, 2); // resolvers ask authoritative servers without RD
  header.writeUInt16BE(1, 4);
  header.writeUInt16BE(edns ? 1 : 0, 10);
  const labels = name.split(".").map((l) => Buffer.concat([Buffer.from([l.length]), Buffer.from(l, "latin1")]));
  const question = Buffer.alloc(4);
  question.writeUInt16BE(type, 0);
  question.writeUInt16BE(1, 2);
  const parts = [header, ...labels, Buffer.from([0]), question];
  if (edns) {
    let options = Buffer.alloc(0);
    if (subnet) {
      options = Buffer.alloc(8 + subnet.bytes.length);
      options.writeUInt16BE(8, 0);
      options.writeUInt16BE(4 + subnet.bytes.length, 2);
      options.writeUInt16BE(subnet.family, 4);
      options[6] = subnet.prefix;
      Buffer.from(subnet.bytes).copy(options, 8);
    }
    const opt = Buffer.alloc(11);
    opt.writeUInt16BE(41, 1);
    opt.writeUInt16BE(1232, 3);
    opt.writeUInt16BE(options.length, 9);
    parts.push(opt, options);
  }
  return Buffer.concat(parts);
}
