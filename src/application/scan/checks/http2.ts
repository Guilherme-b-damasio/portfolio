import type { ExposureCheck, Finding, ScanContext } from "../../../domain/exposure.js";
import { classifyHttp2, expectedHttp2Family, HTTP2_FAMILY_NAMES } from "../http2-stack.js";
import { BROWSER_NAMES } from "../user-agent.js";

/**
 * A second opinion after TLS: the first HTTP/2 frames are written by the client's own HTTP stack.
 * Tools that copy a browser's TLS handshake (curl-impersonate, uTLS) often forget this layer.
 */
export class Http2StackCheck implements ExposureCheck {
  readonly id = "http2-stack";

  run({ observation, claimed }: ScanContext): Finding[] {
    const fp = observation.http2;
    if (!fp) return [];
    const { family, evidence } = classifyHttp2(fp.preface);
    const expected = expectedHttp2Family(claimed);
    const proof = [`Akamai: ${fp.akamai}`, ...evidence.map((e) => `traço: ${e}`)];

    if (expected && family !== expected) {
      const known = family !== "desconhecida";
      return [
        {
          id: this.id,
          layer: "http",
          verdict: known ? "contradicao" : "info",
          title: known
            ? `Seu User-Agent diz ${BROWSER_NAMES[claimed.browser]}, mas o HTTP/2 é de ${HTTP2_FAMILY_NAMES[family]}`
            : `O HTTP/2 desta conexão não tem a cara de um ${BROWSER_NAMES[claimed.browser]}`,
          detail: `Um ${BROWSER_NAMES[claimed.browser]} de verdade abre o HTTP/2 como ${HTTP2_FAMILY_NAMES[expected]}: a ordem dos pseudo-headers e as janelas que ele pede quase nunca mudam. Ferramentas que imitam o handshake TLS de um navegador costumam esquecer esta camada.`,
          evidence: proof,
        },
      ];
    }
    return [
      {
        id: this.id,
        layer: "http",
        verdict: claimed.tool ? "info" : "ok",
        title: claimed.tool
          ? `O HTTP/2 confirma: ${HTTP2_FAMILY_NAMES[family]}`
          : `O HTTP/2 confirma o que o User-Agent diz: ${HTTP2_FAMILY_NAMES[family]}`,
        detail: "SETTINGS, WINDOW_UPDATE e a ordem dos pseudo-headers, lidos dos primeiros bytes da conexão.",
        evidence: proof,
      },
    ];
  }
}
