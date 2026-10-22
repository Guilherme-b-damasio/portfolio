import type {
  LeakProbe,
  LeakProbes,
  LeakReport,
  ResolverRelation,
  ResolverSighting,
  ResolverView,
} from "../domain/dns-leak.js";
import type { ReverseDns, Verdict } from "../domain/exposure.js";
import { addressKind, inPrefix, ipVersion, plainIp } from "./scan/ip.js";

// Public resolvers, by the name of the address they query from or by their published egress ranges.
// Their egress addresses often have no PTR, so the ranges catch what the names miss.
const PUBLIC_RESOLVERS: { operator: string; ptr: RegExp; ranges: [string, number][] }[] = [
  {
    operator: "Google",
    ptr: /(^|\.)(dns\.google|1e100\.net)$/,
    ranges: [
      ["172.253.0.0", 16],
      ["74.125.0.0", 16],
      ["2404:6800::", 32],
      ["2607:f8b0::", 32],
      ["2800:3f0::", 32],
      ["2a00:1450::", 32],
    ],
  },
  {
    operator: "Cloudflare",
    ptr: /(^|\.)(one\.one\.one\.one|cloudflare-dns\.com|cloudflare\.com)$/,
    ranges: [
      ["162.158.0.0", 15],
      ["172.64.0.0", 13],
      ["2400:cb00::", 32],
      ["2a06:98c0::", 29],
    ],
  },
  { operator: "Quad9", ptr: /(^|\.)quad9\.net$/, ranges: [] },
  {
    operator: "OpenDNS (Cisco)",
    ptr: /(^|\.)(opendns\.com|umbrella\.com)$/,
    ranges: [
      ["208.67.216.0", 21],
      ["146.112.0.0", 16],
    ],
  },
  { operator: "NextDNS", ptr: /(^|\.)nextdns\.io$/, ranges: [] },
  { operator: "AdGuard DNS", ptr: /(^|\.)adguard(-dns)?\.(com|io)$/, ranges: [] },
  { operator: "Control D", ptr: /(^|\.)controld\.com$/, ranges: [] },
];

const SEVERITY: Record<Verdict, number> = { ok: 0, info: 1, exposto: 2, contradicao: 3 };
const SHORT_SLDS = new Set(["com", "net", "org", "co", "gov", "edu", "ac", "ne", "or"]);

/**
 * The domain an operator registered, roughly: "dns1.telesp.net.br" → "telesp.net.br". No public
 * suffix list on purpose, the country-code second levels cover what this test meets.
 */
export function registeredDomain(name: string | null): string | null {
  if (!name) return null;
  const labels = name.toLowerCase().replace(/\.$/, "").split(".");
  if (labels.length < 2) return null;
  const take = labels.at(-1)!.length === 2 && SHORT_SLDS.has(labels.at(-2)!) ? 3 : 2;
  return labels.length >= take ? labels.slice(-take).join(".") : null;
}

function publicOperator(address: string, reverseDns: string | null): string | null {
  const name = reverseDns?.toLowerCase().replace(/\.$/, "") ?? "";
  const known = PUBLIC_RESOLVERS.find(
    (r) => (name && r.ptr.test(name)) || r.ranges.some(([net, prefix]) => inPrefix(address, net, prefix)),
  );
  return known?.operator ?? null;
}

/** Same operator by name, or failing that by address: the same /16 in IPv4, the same /32 in IPv6. */
function sameNetwork(a: { ip: string; ptr: string | null }, b: { ip: string; ptr: string | null }): boolean {
  const [da, db] = [registeredDomain(a.ptr), registeredDomain(b.ptr)];
  if (da && db) return da === db;
  if (ipVersion(a.ip) !== ipVersion(b.ip)) return false;
  return inPrefix(a.ip, b.ip, ipVersion(a.ip) === 4 ? 16 : 32);
}

/**
 * The DNS leak test: hands out a name nobody has resolved before, then reads which resolvers asked
 * the authoritative server for it and how they relate to the address the page itself came from.
 */
export class TestDnsLeak {
  constructor(
    private readonly probes: LeakProbes,
    private readonly reverseDns: ReverseDns,
  ) {}

  start(): LeakProbe | null {
    return this.probes.issue();
  }

  async report(token: string, visitorIp: string): Promise<LeakReport | null> {
    const sightings = this.probes.sightings(token);
    if (!sightings) return null;
    const ip = plainIp(visitorIp);
    const lookup = (address: string) =>
      addressKind(address).startsWith("publico") ? this.reverseDns.lookup(address) : Promise.resolve(null);
    // Every lookup has its own deadline, so this waits for the slowest one at most.
    const [yourPtr, ...ptrs] = await Promise.all([lookup(ip), ...sightings.map((s) => lookup(s.address))]);
    const you = { ip, reverseDns: yourPtr };
    const resolvers = sightings.map((s, i) => view(s, ptrs[i], you));
    return { token: token.toLowerCase(), you, resolvers, pending: resolvers.length === 0, ...judge(resolvers) };
  }
}

function view(s: ResolverSighting, reverseDns: string | null, you: { ip: string; reverseDns: string | null }) {
  const operator = publicOperator(s.address, reverseDns);
  const relation: ResolverRelation = operator
    ? "publico"
    : sameNetwork({ ip: s.address, ptr: reverseDns }, { ip: you.ip, ptr: you.reverseDns })
      ? "mesma-rede"
      : "outra-rede";
  const subnet = s.clientSubnet;
  return {
    address: s.address,
    qtypes: s.qtype.split(","),
    reverseDns,
    operator,
    relation,
    clientSubnet: subnet,
    subnetHasYou: subnet ? inPrefix(you.ip, subnet.address, subnet.prefix) : null,
    at: s.at,
  } satisfies ResolverView;
}

function judge(resolvers: ResolverView[]): Pick<LeakReport, "verdict" | "headline" | "detail"> {
  if (!resolvers.length)
    return {
      verdict: "info",
      headline: "nenhum resolvedor perguntou ainda",
      detail:
        "O navegador pode ter usado um cache, um bloqueador pode ter barrado o nome ou a zona ainda não está delegada a este servidor.",
    };
  const findings = resolvers.map((r): [Verdict, string, string] => {
    const who = r.operator ?? r.reverseDns ?? r.address;
    if (r.subnetHasYou === false)
      return [
        "contradicao",
        `o DNS sai por outra rede (${who})`,
        `O resolvedor repassou a sub-rede ${r.clientSubnet!.address}/${r.clientSubnet!.prefix}, que não contém o IP de onde veio esta página. Numa VPN, isso é a rede de verdade aparecendo pelo DNS.`,
      ];
    if (r.relation === "outra-rede")
      return [
        "exposto",
        `o resolvedor é de outra rede (${who})`,
        "Nem da sua rede, nem um resolvedor público conhecido. Se você está numa VPN, suas consultas estão escapando por fora dela; numa empresa ou faculdade, costuma ser o resolvedor interno.",
      ];
    if (r.clientSubnet)
      return [
        "exposto",
        `${who} repassa a sua sub-rede`,
        `Cada servidor autoritativo que você consulta recebe ${r.clientSubnet.address}/${r.clientSubnet.prefix} (EDNS Client Subnet).`,
      ];
    if (r.relation === "publico")
      return [
        "info",
        `você usa o resolvedor público ${r.operator}`,
        "Seu provedor não vê os nomes que você resolve; o operador do resolvedor, sim.",
      ];
    return [
      "ok",
      "o resolvedor é da mesma rede que você",
      "As consultas saem pelo mesmo caminho que esta página. Numa VPN, é o resolvedor dela; sem VPN, o do seu provedor.",
    ];
  });
  const [verdict, headline, detail] = findings.reduce((worst, f) => (SEVERITY[f[0]] > SEVERITY[worst[0]] ? f : worst));
  return { verdict, headline, detail };
}
