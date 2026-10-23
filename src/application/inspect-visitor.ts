import type { CrowdCounts, CrowdView } from "../domain/anonymity.js";
import type {
  ClientProbe,
  ExposureCheck,
  ExposureReport,
  Finding,
  Observation,
  ReverseDns,
  ScanContext,
  Signal,
  Verdict,
} from "../domain/exposure.js";
import type { IpIntel, IpLookup } from "../domain/ip-intel.js";
import { isGrease } from "../domain/tls.js";
import { classifyHttp2, HTTP2_FAMILY_NAMES } from "./scan/http2-stack.js";
import { addressKind, ipVersion, plainIp } from "../domain/ip.js";
import { classifyStack, FAMILY_NAMES, tlsView } from "./scan/tls-stack.js";
import { visitorTraits } from "./scan/traits.js";
import { parseUserAgent } from "./scan/user-agent.js";

const ORDER: Record<Verdict, number> = { contradicao: 0, exposto: 1, info: 2, ok: 3 };

// Headers worth showing as evidence: they are what any site reads about you without asking.
const SHOWN_HEADERS = [
  "user-agent",
  "accept-language",
  "accept-encoding",
  "sec-ch-ua",
  "sec-ch-ua-mobile",
  "sec-ch-ua-platform",
  "sec-gpc",
  "dnt",
  "referer",
];

/**
 * Cross-examines what a visitor's connection says about them: the request the server saw
 * and, when JavaScript ran, what the browser reported. Nothing here is stored or logged.
 */
export class InspectVisitor {
  constructor(
    private readonly checks: ExposureCheck[],
    private readonly reverseDns: ReverseDns,
    private readonly ipIntel: IpIntel | null = null,
    private readonly crowd: CrowdCounts | null = null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(observation: Observation, probe: ClientProbe | null): Promise<ExposureReport> {
    const ip = plainIp(observation.ip);
    const kind = addressKind(ip);
    // Both are about the address alone, and neither is asked about an address that is not public.
    const [reverseDns, ipLookup] = kind.startsWith("publico")
      ? await Promise.all([this.reverseDns.lookup(ip), this.ipIntel?.lookup(ip) ?? null])
      : [null, null];
    const ctx: ScanContext = {
      observation,
      probe,
      claimed: parseUserAgent(observation.headers["user-agent"]),
      reverseDns,
      ipLookup,
      now: this.now(),
    };

    // The crowd counts a visitor only when the browser answered: a scan with curl is not a visitor,
    // and a report of its own traits would be a report of one.
    const traits = visitorTraits(ctx);
    if (probe) this.crowd?.record(traits);
    const crowd: CrowdView | null = this.crowd
      ? { since: this.crowd.since, counted: this.crowd.counted, traits: this.crowd.rarity(traits) }
      : null;

    const findings: Finding[] = [];
    for (const check of this.checks) {
      try {
        findings.push(...check.run(ctx));
      } catch {
        // One broken rule must not take the whole report down; the others still stand.
      }
    }
    findings.sort((a, b) => ORDER[a.verdict] - ORDER[b.verdict]);

    return {
      claimed: ctx.claimed,
      signals: [
        ...networkSignals(observation, reverseDns, ipLookup),
        ...httpSignals(observation),
        ...tlsSignals(observation),
        ...browserSignals(probe),
      ],
      findings,
      summary: {
        exposures: findings.filter((f) => f.verdict === "exposto").length,
        contradictions: findings.filter((f) => f.verdict === "contradicao").length,
        checks: this.checks.length,
        probe: probe != null,
      },
      crowd,
      tls: observation.tls && tlsView(observation.tls),
      scannedAt: ctx.now.toISOString(),
    };
  }
}

function networkSignals(observation: Observation, reverseDns: string | null, ipLookup: IpLookup | null): Signal[] {
  const ip = plainIp(observation.ip);
  const origin = ipLookup?.origin;
  return [
    { layer: "rede", label: "IP", value: ip },
    { layer: "rede", label: "versão", value: `IPv${ipVersion(ip)}` },
    { layer: "rede", label: "DNS reverso", value: reverseDns ?? "nenhum" },
    // Only shown when some list was actually read: saying "not a datacenter" without one would be a guess.
    ...(ipLookup?.updatedAt
      ? [
          {
            layer: "rede" as const,
            label: "dono do bloco",
            value: origin
              ? `${origin.owner}${origin.detail ? ` (${origin.detail})` : ""} · ${origin.block}`
              : "fora das listas de datacenter e Tor",
          },
        ]
      : []),
    {
      layer: "rede",
      label: "caminho",
      value: observation.viaProxy
        ? "você → Traefik (TLS) → este pod"
        : observation.tls
          ? "você → este processo, TLS de ponta a ponta"
          : "você → este processo, direto",
    },
  ];
}

function httpSignals(observation: Observation): Signal[] {
  const headers = SHOWN_HEADERS.flatMap((name) => {
    const value = observation.headers[name];
    return value ? [{ layer: "http" as const, label: name, value }] : [];
  });
  // Each client library writes headers in its own order; a proxy rewrites it, so it only shows without one.
  if (observation.headerOrder?.length) {
    headers.push({ layer: "http", label: "ordem dos cabeçalhos", value: observation.headerOrder.join(" → ") });
  }
  return [...headers, ...http2Signals(observation)];
}

function http2Signals({ http2 }: Observation): Signal[] {
  if (!http2) return [];
  const { preface } = http2;
  const rows: [string, string][] = [
    ["HTTP/2 (Akamai)", http2.akamai],
    ["hash HTTP/2", http2.hash],
    ["pilha h2 provável", HTTP2_FAMILY_NAMES[classifyHttp2(preface).family]],
    ["SETTINGS", preface.settings.map((s) => `${s.name}=${s.value}`).join(", ") || "nenhum"],
    ["WINDOW_UPDATE", preface.windowUpdate === null ? "nenhum" : String(preface.windowUpdate)],
    ["pseudo-headers", preface.pseudoHeaders.join(" → ") || "nenhum"],
  ];
  return rows.map(([label, value]) => ({ layer: "http" as const, label, value }));
}

function tlsSignals({ tls }: Observation): Signal[] {
  if (!tls) return [];
  const { hello } = tls;
  const clean = (codes: string[]) => codes.filter((c) => !isGrease(c));
  const rows: [string, string][] = [
    ["JA4", tls.ja4],
    ["pilha provável", FAMILY_NAMES[classifyStack(hello).family]],
    ["versões", clean(hello.supportedVersions).join(", ") || hello.legacyVersion],
    ["SNI", hello.sni ?? "nenhum"],
    ["ALPN", hello.alpn.join(", ") || "nenhum"],
    ["cifras", `${clean(hello.ciphers).length}${hello.ciphers.some(isGrease) ? " + GREASE" : ""}`],
    ["extensões", `${clean(hello.extensions).length}${hello.extensions.some(isGrease) ? " + GREASE" : ""}`],
    ["key_share", clean(hello.keyShareGroups).join(", ") || "nenhum"],
    ["tamanho", `${hello.bytes} bytes`],
  ];
  return rows.map(([label, value]) => ({ layer: "tls" as const, label, value }));
}

function browserSignals(probe: ClientProbe | null): Signal[] {
  if (!probe) return [];
  const rows: [string, string | number | boolean | undefined][] = [
    ["navigator.platform", probe.platform],
    ["idiomas", probe.languages?.join(", ")],
    ["fuso", probe.timezone],
    [
      "tela",
      probe.screen &&
        `${probe.screen.width}×${probe.screen.height} @${probe.screen.pixelRatio}x · ${probe.screen.colorDepth} bits`,
    ],
    ["núcleos de CPU", probe.hardwareConcurrency],
    ["memória (GB, arredondada)", probe.deviceMemory],
    ["pontos de toque", probe.maxTouchPoints],
    ["GPU", probe.webgl?.renderer],
    ["fabricante da GPU", probe.webgl?.vendor],
    ["hash do canvas", probe.canvasHash],
    ["versões completas", probe.uaData?.fullVersionList?.map((b) => `${b.brand} ${b.version}`).join(", ")],
    ["arquitetura", probe.uaData?.architecture],
    ["versão do sistema", probe.uaData?.platformVersion],
    [
      "rede (estimada)",
      probe.connection?.effectiveType &&
        `${probe.connection.effectiveType}${probe.connection.rttMs != null ? `, rtt ${probe.connection.rttMs}ms` : ""}${probe.connection.downlinkMbps != null ? `, ${probe.connection.downlinkMbps} Mbps` : ""}`,
    ],
    [
      "mídia",
      probe.mediaDevices &&
        `${probe.mediaDevices.audioinput} microfones · ${probe.mediaDevices.audiooutput} saídas · ${probe.mediaDevices.videoinput} câmeras`,
    ],
    ["plugins", probe.pluginCount],
    ["cookies", probe.cookieEnabled == null ? undefined : probe.cookieEnabled ? "ligados" : "desligados"],
    ["webdriver", probe.webdriver],
  ];
  return rows.flatMap(([label, value]) =>
    value === undefined || value === "" ? [] : [{ layer: "navegador" as const, label, value: String(value) }],
  );
}
