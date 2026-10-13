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
