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
import { addressKind, ipVersion, plainIp } from "./scan/ip.js";
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
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(observation: Observation, probe: ClientProbe | null): Promise<ExposureReport> {
    const ip = plainIp(observation.ip);
    const kind = addressKind(ip);
    const reverseDns = kind.startsWith("publico") ? await this.reverseDns.lookup(ip) : null;
    const ctx: ScanContext = {
      observation,
      probe,
      claimed: parseUserAgent(observation.headers["user-agent"]),
      reverseDns,
      now: this.now(),
    };

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
      signals: [...networkSignals(observation, reverseDns), ...httpSignals(observation), ...browserSignals(probe)],
      findings,
      summary: {
        exposures: findings.filter((f) => f.verdict === "exposto").length,
        contradictions: findings.filter((f) => f.verdict === "contradicao").length,
        checks: this.checks.length,
        probe: probe != null,
      },
      scannedAt: ctx.now.toISOString(),
    };
  }
}

function networkSignals(observation: Observation, reverseDns: string | null): Signal[] {
  const ip = plainIp(observation.ip);
  return [
    { layer: "rede", label: "IP", value: ip },
    { layer: "rede", label: "versão", value: `IPv${ipVersion(ip)}` },
    { layer: "rede", label: "DNS reverso", value: reverseDns ?? "nenhum" },
    {
      layer: "rede",
      label: "caminho",
      value: observation.viaProxy ? "você → Traefik (TLS) → este pod" : "você → este processo, direto",
    },
  ];
}

function httpSignals(observation: Observation): Signal[] {
  return SHOWN_HEADERS.flatMap((name) => {
    const value = observation.headers[name];
    return value ? [{ layer: "http" as const, label: name, value }] : [];
  });
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
