import type { ExposureCheck, Finding, ScanContext } from "../../../domain/exposure.js";
import { isGrease } from "../../../domain/tls.js";
import { BROWSER_NAMES } from "../user-agent.js";
import { classifyStack, expectedFamily, FAMILY_NAMES } from "../tls-stack.js";

const POST_QUANTUM: Record<string, string> = { "11ec": "X25519MLKEM768", "6399": "X25519Kyber768Draft00" };
const LEGACY_CIPHERS: Record<string, string> = {
  "000a": "3DES",
  "0004": "RC4",
  "0005": "RC4",
  "0001": "NULL",
  "0002": "NULL",
  "003b": "NULL",
};

/**
 * The User-Agent is a string anyone can type; the ClientHello is written by the TLS library itself.
 * When the two name different software, the UA is lying. This is how CDNs spot bots.
 */
export class TlsStackCheck implements ExposureCheck {
  readonly id = "tls-stack";

  run({ observation, claimed }: ScanContext): Finding[] {
    const fp = observation.tls;
    if (!fp) return [];
    const { family, evidence } = classifyStack(fp.hello);
    const expected = expectedFamily(claimed);
    const proof = [`JA4: ${fp.ja4}`, ...evidence.map((e) => `traço: ${e}`)];

    if (expected && family !== "desconhecida" && family !== expected) {
      return [
        {
          id: this.id,
          layer: "tls",
          verdict: "contradicao",
          title: `Seu User-Agent diz ${BROWSER_NAMES[claimed.browser]}, mas o handshake TLS é de ${FAMILY_NAMES[family]}`,
          detail: `Um ${BROWSER_NAMES[claimed.browser]} de verdade negocia com ${FAMILY_NAMES[expected]}. Trocar o User-Agent é fácil, trocar a pilha TLS não: é assim que CDNs reconhecem bots que fingem ser navegador.`,
          evidence: proof,
        },
      ];
    }
    if (claimed.tool) {
      return [
        {
          id: this.id,
          layer: "tls",
          verdict: "info",
          title: `O handshake confirma: ${FAMILY_NAMES[family]}`,
          detail: "Mesmo trocando o User-Agent, essa assinatura continuaria igual.",
          evidence: proof,
        },
      ];
    }
    return [
      {
        id: this.id,
        layer: "tls",
        verdict: "ok",
        title: `O handshake confirma o que o User-Agent diz: ${FAMILY_NAMES[family]}`,
        detail: "A biblioteca que montou a conexão é a que um navegador desses usa.",
        evidence: proof,
      },
    ];
  }
}

/** What the handshake says about how well the connection is protected. */
export class TlsStrengthCheck implements ExposureCheck {
  readonly id = "tls-strength";

  run({ observation }: ScanContext): Finding[] {
    const hello = observation.tls?.hello;
    if (!hello) return [];
    const findings: Finding[] = [];
    const versions = hello.supportedVersions.filter((v) => !isGrease(v));

    if (!versions.includes("0304")) {
      findings.push({
        id: `${this.id}-version`,
        layer: "tls",
        verdict: "exposto",
        title: "Seu cliente não oferece TLS 1.3",
        detail:
          "TLS 1.2 ainda é seguro bem configurado, mas expõe mais do handshake e depende do servidor escolher bem.",
        evidence: [`versões oferecidas: ${versions.join(", ") || hello.legacyVersion}`],
        fix: "Atualize o cliente ou a biblioteca TLS.",
      });
    }

    const pq = hello.keyShareGroups.filter((g) => POST_QUANTUM[g]);
    findings.push(
      pq.length
        ? {
            id: `${this.id}-pq`,
            layer: "tls",
            verdict: "ok",
            title: `Sua conexão já usa criptografia pós-quântica (${POST_QUANTUM[pq[0]]})`,
            detail:
              "A troca de chaves mistura curva elíptica com ML-KEM. Quem gravar este tráfego hoje não consegue decifrá-lo nem com um computador quântico no futuro.",
            evidence: [`key_share: ${hello.keyShareGroups.filter((g) => !isGrease(g)).join(", ")}`],
          }
        : {
            id: `${this.id}-pq`,
            layer: "tls",
            verdict: "info",
            title: "Sem troca de chaves pós-quântica",
            detail:
              "Hoje está seguro. Mas tráfego gravado agora pode ser decifrado quando existir um computador quântico grande: o ataque “grave agora, decifre depois”.",
            evidence: [`key_share: ${hello.keyShareGroups.join(", ") || "nenhum"}`],
            fix: "Chrome, Edge e Firefox atuais já usam X25519MLKEM768; bibliotecas como OpenSSL 3.5 também.",
          },
    );

    const legacy = hello.ciphers.filter((c) => LEGACY_CIPHERS[c]);
    if (legacy.length) {
      findings.push({
        id: `${this.id}-legacy`,
        layer: "tls",
        verdict: "exposto",
        title: `Seu cliente ainda aceita cifras quebradas: ${[...new Set(legacy.map((c) => LEGACY_CIPHERS[c]))].join(", ")}`,
        detail: "Um servidor mal configurado ou um intermediário pode empurrar a conexão para elas.",
        evidence: legacy.map((c) => `cipher 0x${c}`),
      });
    }

    if (hello.extensions.includes("fe0d")) {
      findings.push({
        id: `${this.id}-ech`,
        layer: "tls",
        verdict: "ok",
        title: "Seu navegador sabe usar ECH",
        detail:
          "Encrypted Client Hello cifra até o nome do site que você está acessando, nos servidores que oferecem. Sem ele, o nome vai em texto claro para quem estiver no caminho.",
        evidence: ["extensão encrypted_client_hello (0xfe0d)", `SNI enviado em claro aqui: ${hello.sni ?? "nenhum"}`],
      });
    } else if (hello.sni) {
      findings.push({
        id: `${this.id}-sni`,
        layer: "tls",
        verdict: "info",
        title: "O nome do site vai em texto claro no handshake",
        detail: "Seu provedor e qualquer rede no caminho veem qual site você abriu, mesmo com HTTPS.",
        evidence: [`SNI: ${hello.sni}`],
      });
    }
    return findings;
  }
}
