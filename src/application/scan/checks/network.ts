import type { ExposureCheck, Finding, ScanContext } from "../../../domain/exposure.js";
import { addressKind, plainIp } from "../../../domain/ip.js";

/**
 * WebRTC gathers the device's own addresses before any connection exists. Modern browsers hide
 * the LAN address behind a random "*.local" name; older ones, some extensions and VPNs don't.
 */
export class WebRtcLeakCheck implements ExposureCheck {
  readonly id = "webrtc";

  run({ probe, observation }: ScanContext): Finding[] {
    const candidates = probe?.webrtcCandidates;
    if (!candidates) return [];
    const unique = [...new Set(candidates.map((c) => plainIp(c.trim().toLowerCase())))];
    if (unique.length === 0) {
      return [
        {
          id: this.id,
          layer: "rede",
          verdict: "ok",
          title: "WebRTC não entregou nenhum endereço",
          detail: "O WebRTC está bloqueado ou desligado aqui, então ele não vaza IP nenhum.",
          evidence: [],
        },
      ];
    }

    const seen = plainIp(observation.ip);
    const privateOnes = unique.filter((a) => addressKind(a) === "privado");
    const otherPublic = unique.filter((a) => /^publico/.test(addressKind(a)) && a !== seen);
    const findings: Finding[] = [];

    if (privateOnes.length) {
      findings.push({
        id: `${this.id}-local`,
        layer: "rede",
        verdict: "exposto",
        title: "Seu IP da rede local vazou",
        detail:
          "Qualquer site pode ler o endereço do seu aparelho dentro da sua rede. Ele ajuda a te reconhecer entre visitas e a mapear sua rede.",
        evidence: privateOnes.map((a) => `candidato WebRTC: ${a}`),
        fix: "Atualize o navegador ou ative a proteção de WebRTC (no Firefox: media.peerconnection.ice.obfuscate_host_addresses).",
      });
    }
    if (otherPublic.length) {
      findings.push({
        id: `${this.id}-public`,
        layer: "rede",
        verdict: "exposto",
        title: "Seu aparelho expõe outro IP público",
        detail: `Você chegou aqui por ${seen}, mas o WebRTC revela também ${otherPublic.join(", ")}. Se você usa VPN, é por aí que o IP real dela vaza.`,
        evidence: otherPublic.map((a) => `candidato WebRTC: ${a}`),
        fix: "Use uma VPN com proteção de WebRTC ou desative o WebRTC para sites em que não faz chamada de vídeo.",
      });
    }
    if (!findings.length) {
      findings.push({
        id: this.id,
        layer: "rede",
        verdict: "ok",
        title: "WebRTC não vaza seu IP",
        detail: "Os candidatos vêm mascarados como nomes .local, que mudam a cada visita.",
        evidence: unique.slice(0, 3).map((a) => `candidato WebRTC: ${a}`),
      });
    }
    return findings;
  }
}

/**
 * Whose network the address belongs to, from the published lists (AWS, Google Cloud, Azure and the
 * Tor exits). A datacenter block says the visitor is behind a VPN, a proxy or a machine, which is
 * why those addresses meet a captcha on half the web; a Tor exit is shared by so many people that
 * the address stops saying anything about this one. Nothing is asked of a third party: the lists
 * are public files this server already keeps in memory.
 */
export class IpOriginCheck implements ExposureCheck {
  readonly id = "ip-origin";

  run({ ipLookup, observation }: ScanContext): Finding[] {
    // No list in hand: the scan says nothing rather than guessing the address is residential.
    if (!ipLookup?.updatedAt) return [];
    const ip = plainIp(observation.ip);
    const loaded = `listas carregadas em ${ipLookup.updatedAt}`;
    const origin = ipLookup.origin;

    if (!origin) {
      return [
        {
          id: `${this.id}-comum`,
          layer: "rede",
          verdict: "info",
          title: "Seu IP é de acesso comum, não de datacenter",
          detail:
            "Ele não está nas faixas da AWS, do Google Cloud ou da Azure, nem entre as saídas do Tor. Para quem recebe a requisição isso é sinal de gente de verdade: nenhum atrito, e também nenhum disfarce — o IP é o da sua casa ou do seu celular.",
          evidence: [`IP ${ip}: fora das listas`, loaded],
        },
      ];
    }

    const where = `${origin.owner}${origin.detail ? ` · ${origin.detail}` : ""}`;
    if (origin.kind === "tor") {
      return [
        {
          id: `${this.id}-tor`,
          layer: "rede",
          verdict: "info",
          title: "Você chegou pela saída de um nó Tor",
          detail:
            "Este endereço é a saída de um relay do Tor, usada por muita gente ao mesmo tempo, então ele não aponta para você. O preço é o atrito: muitos sites bloqueiam ou enchem de captcha o que vem daqui.",
          evidence: [`IP ${ip} no bloco ${origin.block} (${where})`, `lista: ${origin.feed}`, loaded],
        },
      ];
    }
    return [
      {
        id: `${this.id}-datacenter`,
        layer: "rede",
        verdict: "info",
        title: `Seu IP é de datacenter (${origin.owner})`,
        detail:
          "Ninguém mora num datacenter: este endereço é de VPN, proxy ou de uma máquina rodando sozinha. Ele esconde o seu provedor e a sua região, e em troca te coloca na mesma fila dos robôs — captcha, cadastro recusado, limite mais apertado.",
        evidence: [`IP ${ip} no bloco ${origin.block} (${where})`, `lista: ${origin.feed}`, loaded],
      },
    ];
  }
}

/** A PTR record turns an IP into a name, which often spells out the ISP, the connection type and sometimes the city. */
export class ReverseDnsCheck implements ExposureCheck {
  readonly id = "reverse-dns";

  run({ reverseDns, observation }: ScanContext): Finding[] {
    if (!reverseDns) {
      return [
        {
          id: this.id,
          layer: "rede",
          verdict: "ok",
          title: "Seu IP não tem nome público",
          detail: "Não há registro de DNS reverso para ele, então o IP sozinho diz pouco sobre o seu provedor.",
          evidence: [`PTR ${plainIp(observation.ip)}: nenhum`],
        },
      ];
    }
    return [
      {
        id: this.id,
        layer: "rede",
        verdict: "exposto",
        title: "Seu IP tem nome público",
        detail:
          "Qualquer servidor que você acessa consegue esse nome com uma consulta de DNS. Ele costuma revelar o provedor e, às vezes, a região.",
        evidence: [`PTR ${plainIp(observation.ip)} → ${reverseDns}`],
        fix: "Só uma VPN ou o Tor escondem isso: o nome é do IP, não do seu aparelho.",
      },
    ];
  }
}
