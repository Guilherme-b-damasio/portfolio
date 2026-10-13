import type { ExposureCheck, Finding, OsFamily, ScanContext } from "../../../domain/exposure.js";
import { BROWSER_NAMES, OS_NAMES, osFromPlatform, parseUserAgent, sameOs } from "../user-agent.js";

/** The UA in the HTTP header and the one JavaScript reads come from the same place unless something rewrote one. */
export class UserAgentLayersCheck implements ExposureCheck {
  readonly id = "ua-layers";

  run({ observation, probe }: ScanContext): Finding[] {
    const header = observation.headers["user-agent"];
    if (!probe?.userAgent || !header || probe.userAgent === header) return [];
    return [
      {
        id: this.id,
        layer: "navegador",
        verdict: "contradicao",
        title: "Seu User-Agent foi trocado em só uma camada",
        detail:
          "O que chega no cabeçalho HTTP é diferente do que o JavaScript lê. É o rastro típico de extensão de troca de UA ou do modo de dispositivo do DevTools.",
        evidence: [`HTTP: ${header}`, `JS:   ${probe.userAgent}`],
      },
    ];
  }
}

/** navigator.platform and userAgentData.platform come from the real OS, which the UA string may not. */
export class PlatformCheck implements ExposureCheck {
  readonly id = "platform";

  run({ claimed, probe }: ScanContext): Finding[] {
    if (!probe || claimed.os === "outro") return [];
    const sources: [string, string | undefined][] = [
      ["navigator.platform", probe.platform],
      ["userAgentData.platform", probe.uaData?.platform],
    ];
    const clashes = sources.filter(([, value]) => {
      const os = osFromPlatform(value);
      return os && os !== "outro" && !sameOs(os, claimed.os);
    });
    if (!clashes.length) return [];
    const real = osFromPlatform(clashes[0][1]) as OsFamily;
    return [
      {
        id: this.id,
        layer: "navegador",
        verdict: "contradicao",
        title: `Você diz ${OS_NAMES[claimed.os]}, mas o navegador roda em ${OS_NAMES[real]}`,
        detail: "O sistema real escapa por APIs que as extensões de troca de User-Agent esquecem de falsificar.",
        evidence: clashes.map(([k, v]) => `${k}: ${v}`),
      },
    ];
  }
}

const SOFTWARE_GPU = /SwiftShader|llvmpipe|softpipe|Software|Mesa OffScreen|Microsoft Basic Render/i;
const GPU_OS: [RegExp, OsFamily[]][] = [
  [/Direct3D|D3D11|D3D9/i, ["windows"]],
  [/Apple (M\d|GPU)|Apple A\d/i, ["macos", "ios"]],
  [/Adreno|Mali|PowerVR|Immortalis|Xclipse/i, ["android", "linux", "chromeos"]],
];

/** WebGL hands out the GPU model. It identifies the machine and can contradict the claimed OS. */
export class GpuCheck implements ExposureCheck {
  readonly id = "gpu";

  run({ claimed, probe }: ScanContext): Finding[] {
    const renderer = probe?.webgl?.renderer;
    if (!renderer) return [];
    const evidence = [
      `WebGL renderer: ${renderer}`,
      ...(probe?.webgl?.vendor ? [`vendor: ${probe.webgl.vendor}`] : []),
    ];
    const findings: Finding[] = [];

    if (SOFTWARE_GPU.test(renderer)) {
      findings.push({
        id: `${this.id}-software`,
        layer: "navegador",
        verdict: "contradicao",
        title: "Seu navegador desenha sem placa de vídeo",
        detail:
          "Renderização por software é rara em quem navega de verdade e comum em máquina virtual, servidor e navegador headless.",
        evidence,
      });
    }

    const expected = GPU_OS.find(([re]) => re.test(renderer))?.[1];
    if (expected && claimed.os !== "outro" && !expected.some((os) => sameOs(os, claimed.os))) {
      findings.push({
        id: `${this.id}-os`,
        layer: "navegador",
        verdict: "contradicao",
        title: `Essa placa de vídeo não existe em ${OS_NAMES[claimed.os]}`,
        detail: `O WebGL mostra uma GPU de ${expected.map((os) => OS_NAMES[os]).join("/")}, mas o User-Agent diz ${OS_NAMES[claimed.os]}.`,
        evidence,
      });
    }

    // Safari answers a generic "Apple GPU"; Firefox with resistFingerprinting answers "Mozilla".
    const generic = /^(Apple GPU|Mozilla|WebKit WebGL)$/i.test(renderer.trim());
    findings.push(
      generic
        ? {
            id: this.id,
            layer: "navegador",
            verdict: "ok",
            title: "Seu navegador esconde o modelo da GPU",
            detail: "O WebGL responde um nome genérico, igual para todo mundo com o mesmo navegador.",
            evidence,
          }
        : {
            id: this.id,
            layer: "navegador",
            verdict: "exposto",
            title: "O modelo da sua placa de vídeo está visível",
            detail:
              "Qualquer site lê isso sem pedir permissão. Junto com tela, fuso e fontes, basta para te reconhecer sem cookie.",
            evidence,
            fix: "Firefox com privacy.resistFingerprinting ou o Brave mascaram isso.",
          },
    );
    return findings;
  }
}

/** UTC offset of an IANA zone at a given instant, in minutes east of UTC; null if the zone is unknown. */
export function zoneOffsetMinutes(timeZone: string, at: Date): number | null {
  try {
    const name =
      new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
        .formatToParts(at)
        .find((p) => p.type === "timeZoneName")?.value ?? "";
    const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
    if (!m) return name === "GMT" ? 0 : null;
    return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
  } catch {
    return null;
  }
}

/**
 * The time zone name and the clock offset are two separate APIs. Spoofing tools often set
 * one and forget the other; the server knows the real offset of every zone, so it can tell.
 */
export class TimezoneCheck implements ExposureCheck {
  readonly id = "timezone";

  run({ probe, now }: ScanContext): Finding[] {
    if (!probe?.timezone || probe.timezoneOffsetMinutes == null) return [];
    const expected = zoneOffsetMinutes(probe.timezone, now);
    const evidence = [`Intl: ${probe.timezone}`, `Date: UTC${formatOffset(probe.timezoneOffsetMinutes)}`];
    if (expected == null) return [];
    if (expected !== probe.timezoneOffsetMinutes) {
      return [
        {
          id: this.id,
          layer: "navegador",
          verdict: "contradicao",
          title: "Seu fuso horário foi falsificado pela metade",
          detail: `${probe.timezone} está em UTC${formatOffset(expected)} agora, mas o relógio do navegador diz UTC${formatOffset(probe.timezoneOffsetMinutes)}.`,
          evidence,
        },
      ];
    }
    return [
      {
        id: this.id,
        layer: "navegador",
        verdict: "info",
        title: `Seu fuso entrega onde você está: ${probe.timezone}`,
        detail:
          "Mesmo atrás de VPN, o fuso do sistema continua o mesmo. Quando ele não bate com o país do IP, é sinal de VPN.",
        evidence,
      },
    ];
  }
}

function formatOffset(minutes: number): string {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/** Signals that a script, not a person, is driving the browser. */
export class AutomationCheck implements ExposureCheck {
  readonly id = "automation";

  run({ claimed, probe }: ScanContext): Finding[] {
    const evidence: string[] = [];
    if (probe?.webdriver) evidence.push("navigator.webdriver: true");
    if (claimed.tool === "Chrome headless") evidence.push("User-Agent contém HeadlessChrome");
    if (probe?.userAgent && parseUserAgent(probe.userAgent).tool === "Chrome headless")
      evidence.push("navigator.userAgent contém HeadlessChrome");
    // Desktop Chrome has listed the same five PDF viewer plugins since v94; headless lists none.
    if (claimed.browser === "chrome" && !claimed.mobile && probe?.pluginCount === 0)
      evidence.push("navigator.plugins: 0 (Chrome de desktop lista 5)");
    if (!evidence.length) return [];
    return [
      {
        id: this.id,
        layer: "navegador",
        verdict: "contradicao",
        title: "Este navegador parece controlado por automação",
        detail:
          "Selenium, Playwright e Puppeteer deixam essas marcas por padrão. Sistemas anti-bot procuram exatamente por elas.",
        evidence,
      },
    ];
  }
}

// Stable releases come every four weeks, plus a longer gap around the holidays. Anchored on a
// known release so no version table goes stale; if the cadence speeds up, this only underestimates.
const CADENCE: Partial<Record<string, { version: number; date: number; days: number }>> = {
  chrome: { version: 141, date: Date.UTC(2025, 8, 30), days: 29.5 },
  edge: { version: 141, date: Date.UTC(2025, 9, 2), days: 29.5 },
  firefox: { version: 143, date: Date.UTC(2025, 8, 16), days: 28 },
};
const FIREFOX_ESR = new Set([115, 128, 140, 153]);

export function expectedStable(browser: string, now: Date): number | null {
  const c = CADENCE[browser];
  if (!c) return null;
  return c.version + Math.floor((now.getTime() - c.date) / (c.days * 86_400_000));
}

/** An old browser carries every flaw fixed since, and the version is right there in the User-Agent. */
export class OutdatedBrowserCheck implements ExposureCheck {
  readonly id = "outdated";

  run({ claimed, now }: ScanContext): Finding[] {
    const expected = expectedStable(claimed.browser, now);
    if (expected == null || claimed.version == null || claimed.tool) return [];
    const name = BROWSER_NAMES[claimed.browser];
    const behind = expected - claimed.version;
    const evidence = [`${name} ${claimed.version}`, `estável estimada hoje: ~${expected}`];
    if (claimed.browser === "firefox" && FIREFOX_ESR.has(claimed.version) && behind > 0) {
      return [
        {
          id: this.id,
          layer: "navegador",
          verdict: "info",
          title: `Firefox ${claimed.version} parece ser a versão ESR`,
          detail:
            "A ESR recebe correções de segurança mesmo sendo mais antiga, então não é falha. Mas ela é rara e te destaca.",
          evidence,
        },
      ];
    }
    if (behind >= 3) {
      return [
        {
          id: this.id,
          layer: "navegador",
          verdict: "exposto",
          title: `Seu ${name} está umas ${behind} versões atrás`,
          detail:
            "Cada versão nova corrige falhas que viram públicas no dia do lançamento. Qualquer site lê sua versão no User-Agent e sabe quais delas você ainda tem.",
          evidence,
          fix: `Atualize o ${name} e reinicie o navegador.`,
        },
      ];
    }
    return [
      {
        id: this.id,
        layer: "navegador",
        verdict: "ok",
        title: `${name} ${claimed.version} está em dia`,
        detail: "Pela cadência de lançamentos, você está na versão estável atual ou bem perto dela.",
        evidence,
      },
    ];
  }
}

/** How many stable traits the browser hands out. None of them needs permission, and together they rarely repeat. */
export class FingerprintSurfaceCheck implements ExposureCheck {
  readonly id = "fingerprint";

  run({ probe }: ScanContext): Finding[] {
    if (!probe) return [];
    const traits: string[] = [];
    if (probe.canvasHash) traits.push(`canvas: ${probe.canvasHash}`);
    if (probe.webgl?.renderer) traits.push(`gpu: ${probe.webgl.renderer}`);
    if (probe.screen)
      traits.push(
        `tela: ${probe.screen.width}×${probe.screen.height} @${probe.screen.pixelRatio}x, ${probe.screen.colorDepth} bits`,
      );
    if (probe.timezone) traits.push(`fuso: ${probe.timezone}`);
    if (probe.languages?.length) traits.push(`idiomas: ${probe.languages.join(", ")}`);
    if (probe.hardwareConcurrency) traits.push(`núcleos: ${probe.hardwareConcurrency}`);
    if (probe.deviceMemory) traits.push(`memória: ${probe.deviceMemory} GB`);
    if (probe.maxTouchPoints != null) traits.push(`toque: ${probe.maxTouchPoints} pontos`);
    if (probe.mediaDevices) {
      const { audioinput, audiooutput, videoinput } = probe.mediaDevices;
      traits.push(`dispositivos: ${audioinput} mic, ${audiooutput} saídas, ${videoinput} câmeras`);
    }
    if (traits.length < 3) return [];
    return [
      {
        id: this.id,
        layer: "navegador",
        verdict: "exposto",
        title: `Seu navegador entrega ${traits.length} traços estáveis sem pedir permissão`,
        detail:
          "Nenhum deles te identifica sozinho. Juntos formam uma impressão digital que sobrevive a limpar cookies e ao modo anônimo.",
        evidence: traits,
        fix: "Navegadores com proteção de fingerprint (Brave, Firefox com resistFingerprinting, Tor Browser) padronizam ou embaralham esses valores.",
      },
    ];
  }
}
