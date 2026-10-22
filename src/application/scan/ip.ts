/** Strips the IPv4-mapped IPv6 prefix Node puts on IPv4 clients ("::ffff:1.2.3.4"). */
export function plainIp(ip: string): string {
  return ip.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, "");
}

export type AddressKind = "mdns" | "privado" | "loopback" | "cgnat" | "publico-v4" | "publico-v6" | "local-v6";

/** Classifies an address the way the WebRTC check needs: is it hidden, local, or public? */
export function addressKind(address: string): AddressKind {
  const a = plainIp(address.trim().toLowerCase());
  if (a.endsWith(".local")) return "mdns";
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(a);
  if (v4) {
    const [o1, o2] = [Number(v4[1]), Number(v4[2])];
    if (o1 === 127) return "loopback";
    if (o1 === 10 || (o1 === 172 && o2 >= 16 && o2 <= 31) || (o1 === 192 && o2 === 168) || (o1 === 169 && o2 === 254))
      return "privado";
    if (o1 === 100 && o2 >= 64 && o2 <= 127) return "cgnat";
    return "publico-v4";
  }
  if (a === "::1") return "loopback";
  // Link-local (fe80::/10) and unique-local (fc00::/7) never leave the network.
  if (/^fe[89ab]/.test(a) || /^f[cd]/.test(a)) return "local-v6";
  return "publico-v6";
}

export function ipVersion(ip: string): 4 | 6 {
  return /^\d+\.\d+\.\d+\.\d+$/.test(plainIp(ip)) ? 4 : 6;
}

/** The address as bytes (4 or 16), or null when it is not one. */
export function ipBytes(ip: string): number[] | null {
  const a = plainIp(ip.trim().toLowerCase());
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(a);
  if (v4) {
    const bytes = v4.slice(1).map(Number);
    return bytes.every((b) => b <= 255) ? bytes : null;
  }
  const halves = a.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - left.length - right.length : 0;
  if (fill < 0) return null;
  const groups = [...left, ...Array<string>(fill).fill("0"), ...right];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.flatMap((g) => [parseInt(g, 16) >> 8, parseInt(g, 16) & 0xff]);
}

/** Whether `ip` falls inside `network/prefix`; false across address families. */
export function inPrefix(ip: string, network: string, prefix: number): boolean {
  const [a, b] = [ipBytes(ip), ipBytes(network)];
  if (!a || !b || a.length !== b.length || prefix > a.length * 8) return false;
  for (let bit = 0; bit < prefix; bit += 8) {
    const mask = prefix - bit >= 8 ? 0xff : (0xff << (8 - (prefix - bit))) & 0xff;
    if ((a[bit / 8] & mask) !== (b[bit / 8] & mask)) return false;
  }
  return true;
}
