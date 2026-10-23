import type { Trait } from "../../domain/anonymity.js";
import type { ScanContext } from "../../domain/exposure.js";

/**
 * The traits the crowd counts, each one on its own and never as a combination: what the User-Agent
 * claims, the coarse facts any script reads, and the two fingerprints of the connection itself.
 * The values are the same ones the report already shows the visitor.
 */
export function visitorTraits({ probe, claimed, observation }: ScanContext): Trait[] {
  const traits: Trait[] = [];
  const add = (attribute: string, label: string, value: string | number | undefined | null) => {
    if (value === undefined || value === null || value === "") return;
    traits.push({ attribute, label, value: String(value) });
  };

  add(
    "navegador",
    "seu navegador",
    claimed.tool ?? `${claimed.browser}${claimed.version ? ` ${claimed.version}` : ""}`,
  );
  add("sistema", "seu sistema", `${claimed.os}${claimed.mobile ? " no celular" : ""}`);
  add("gpu", "sua GPU", probe?.webgl?.renderer);
  add("tela", "sua tela", probe?.screen && `${probe.screen.width}×${probe.screen.height} @${probe.screen.pixelRatio}x`);
  add("fuso", "seu fuso", probe?.timezone);
  add("idioma", "seu idioma", probe?.languages?.[0]);
  add("nucleos", "seu número de núcleos", probe?.hardwareConcurrency);
  add("canvas", "seu canvas", probe?.canvasHash);
  add("ja4", "seu JA4", observation.tls?.ja4);
  add("http2", "seu fingerprint de HTTP/2", observation.http2?.hash);
  return traits;
}
