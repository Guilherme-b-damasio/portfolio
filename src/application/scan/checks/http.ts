import type { BrowserFamily, ExposureCheck, Finding, ScanContext } from "../../../domain/exposure.js";
import { BROWSER_NAMES, OS_NAMES, osFromPlatform, sameOs } from "../user-agent.js";

/** curl, Python, Go... say who they are in the User-Agent. */
export class ToolClientCheck implements ExposureCheck {
  readonly id = "tool";

  run({ claimed, observation }: ScanContext): Finding[] {
    if (!claimed.tool) return [];
    return [
      {
        id: this.id,
        layer: "http",
        verdict: "exposto",
        title: `Você chegou aqui com ${claimed.tool}, não com um navegador`,
        detail:
          "O User-Agent entrega a ferramenta na primeira linha. É assim que APIs e WAFs separam script de pessoa sem esforço nenhum.",
        evidence: [`user-agent: ${observation.headers["user-agent"] ?? ""}`],
        fix: "Trocar o User-Agent não basta: a fase de TLS deste scan reconhece a biblioteca pelo handshake.",
      },
    ];
  }
}

const GREASE = /not.?a.?brand|^\W|\W$/i;
const BRAND_FAMILY: [RegExp, BrowserFamily][] = [
  [/^Microsoft Edge$/i, "edge"],
  [/^Opera$/i, "opera"],
  [/^Samsung Internet$/i, "samsung"],
  [/^(Google Chrome|Brave|Chromium)$/i, "chrome"],
];

/** `"Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="99"` → real brands only. */
export function parseBrands(header: string | undefined): { brand: string; version: string }[] {
  if (!header) return [];
  return [...header.matchAll(/"([^"]*)"\s*;\s*v="([^"]*)"/g)]
    .map(([, brand, version]) => ({ brand, version }))
    .filter((b) => !GREASE.test(b.brand));
}

/**
 * Chromium browsers send Client Hints next to the User-Agent; Firefox and Safari never do.
 * Spoofing extensions usually rewrite the UA and forget the hints, which is the tell.
 */
export class ClientHintsCheck implements ExposureCheck {
  readonly id = "client-hints";

  run({ claimed, observation, probe }: ScanContext): Finding[] {
    const header = observation.headers["sec-ch-ua"];
    const brands = parseBrands(header);
    const findings: Finding[] = [];
    const chromium = ["chrome", "edge", "opera", "samsung"].includes(claimed.browser);

    if (brands.length && (claimed.browser === "firefox" || claimed.browser === "safari")) {
      findings.push({
        id: `${this.id}-engine`,
        layer: "http",
        verdict: "contradicao",
        title: `Seu User-Agent diz ${BROWSER_NAMES[claimed.browser]}, mas só Chromium manda Client Hints`,
        detail: "Firefox e Safari não implementam Sec-CH-UA. Quem mandou isso é um Chromium com o User-Agent trocado.",
        evidence: [`sec-ch-ua: ${header}`, `user-agent: ${observation.headers["user-agent"] ?? ""}`],
      });
    }

    if (brands.length && chromium && claimed.version != null) {
      // The product brand, not the engine: Edge sends "Microsoft Edge" and "Chromium".
      const product = brands.find((b) => !/^Chromium$/i.test(b.brand)) ?? brands[0];
      const family = BRAND_FAMILY.find(([re]) => re.test(product.brand))?.[1];
      const hintedVersion = Number(product.version);
      // Opera numbers itself apart from Chromium, so only its brand can be compared.
      if (family === claimed.browser && hintedVersion && hintedVersion !== claimed.version) {
        findings.push({
          id: `${this.id}-version`,
          layer: "http",
          verdict: "contradicao",
          title: "A versão do User-Agent não bate com a dos Client Hints",
          detail: `O User-Agent diz versão ${claimed.version}, os Client Hints dizem ${hintedVersion}. Um dos dois foi editado.`,
          evidence: [`sec-ch-ua: ${header}`, `user-agent: ${observation.headers["user-agent"] ?? ""}`],
        });
      } else if (family && family !== claimed.browser) {
        findings.push({
          id: `${this.id}-brand`,
          layer: "http",
          verdict: "contradicao",
          title: `Os Client Hints dizem ${BROWSER_NAMES[family]}, o User-Agent diz ${BROWSER_NAMES[claimed.browser]}`,
          detail: "As duas camadas deveriam contar a mesma história.",
          evidence: [`sec-ch-ua: ${header}`],
        });
      }
    }

    const platformHint = osFromPlatform(observation.headers["sec-ch-ua-platform"]);
    if (platformHint && platformHint !== "outro" && claimed.os !== "outro" && !sameOs(platformHint, claimed.os)) {
      findings.push({
        id: `${this.id}-platform`,
        layer: "http",
        verdict: "contradicao",
        title: `O User-Agent diz ${OS_NAMES[claimed.os]}, o Sec-CH-UA-Platform diz ${OS_NAMES[platformHint]}`,
        detail: "O sistema operacional foi trocado em uma camada só.",
        evidence: [`sec-ch-ua-platform: ${observation.headers["sec-ch-ua-platform"]}`],
      });
    }

    // High-entropy hints only reach JavaScript, and say more than the frozen User-Agent does.
    const ua = probe?.uaData;
    if (ua?.platform === "Windows" && ua.platformVersion) {
      const major = Number(ua.platformVersion.split(".")[0]);
      if (major >= 13) {
        findings.push({
          id: `${this.id}-windows11`,
          layer: "navegador",
          verdict: "info",
          title: "Seu User-Agent diz Windows 10, mas você está no Windows 11",
          detail:
            "O Chrome congelou o User-Agent em “Windows NT 10.0” para reduzir fingerprint. A versão real continua disponível a qualquer script, via Client Hints.",
          evidence: [`userAgentData.platformVersion: ${ua.platformVersion}`],
        });
      }
    }
    if (ua?.model) {
      findings.push({
        id: `${this.id}-model`,
        layer: "navegador",
        verdict: "exposto",
        title: `O modelo exato do seu aparelho está visível: ${ua.model}`,
        detail:
          "O User-Agent esconde o modelo (“Android 10; K”), mas os Client Hints de alta entropia entregam para qualquer script que pedir.",
        evidence: [`userAgentData.model: ${ua.model}`],
      });
    }

    if (!findings.length && brands.length) {
      findings.push({
        id: this.id,
        layer: "http",
        verdict: "ok",
        title: "Client Hints e User-Agent contam a mesma história",
        detail: "Marca, versão e sistema batem entre as duas camadas.",
        evidence: [`sec-ch-ua: ${header}`],
      });
    }
    return findings;
  }
}

/** Accept-Language is set by the browser; navigator.languages too. Spoofers change one of them. */
export class LanguageCheck implements ExposureCheck {
  readonly id = "language";

  run({ observation, probe }: ScanContext): Finding[] {
    const header = observation.headers["accept-language"];
    const first = header?.split(",")[0]?.split(";")[0]?.trim().toLowerCase();
    const js = probe?.languages?.[0]?.toLowerCase();
    if (!first || !js) return [];
    if (first.split("-")[0] === js.split("-")[0]) return [];
    return [
      {
        id: this.id,
        layer: "navegador",
        verdict: "contradicao",
        title: "O idioma do cabeçalho não é o idioma do navegador",
        detail: `O HTTP pede “${first}”, mas o JavaScript diz “${js}”. Extensões de privacidade costumam trocar só um dos dois.`,
        evidence: [`accept-language: ${header}`, `navigator.languages: ${probe?.languages?.join(", ")}`],
      },
    ];
  }
}

/** Global Privacy Control is the opt-out signal sites must honour in some jurisdictions; DNT is its ignored ancestor. */
export class PrivacySignalCheck implements ExposureCheck {
  readonly id = "gpc";

  run({ observation, probe }: ScanContext): Finding[] {
    const gpc = observation.headers["sec-gpc"] === "1" || probe?.globalPrivacyControl === true;
    return [
      gpc
        ? {
            id: this.id,
            layer: "http",
            verdict: "ok",
            title: "Você pede para não ser rastreado (GPC)",
            detail: "Seu navegador manda Sec-GPC: 1 em toda requisição.",
            evidence: ["sec-gpc: 1"],
          }
        : {
            id: this.id,
            layer: "http",
            verdict: "info",
            title: "Você não manda o sinal de não-rastreio (GPC)",
            detail:
              "O Global Privacy Control é um aviso que vai em toda requisição. Nem todo site respeita, mas em alguns lugares a lei obriga.",
            evidence: [
              observation.headers.dnt === "1" ? "dnt: 1 (o antigo, que quase ninguém respeita)" : "sec-gpc: ausente",
            ],
            fix: "Firefox, Brave e DuckDuckGo têm a opção; no Chrome, via extensão.",
          },
    ];
  }
}
