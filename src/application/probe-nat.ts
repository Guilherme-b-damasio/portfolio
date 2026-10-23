import type {
  ClaimedAddress,
  NatBindings,
  NatMapping,
  NatReport,
  StunEndpoint,
  StunSighting,
  StunView,
} from "../domain/stun.js";
import { ipVersion, plainIp } from "../domain/ip.js";

/**
 * The NAT probe: the browser gathers ICE candidates against this server's own STUN sockets, and
 * this reads back what those sockets saw coming from the address the page itself came over. Two
 * sockets on different ports are enough to tell an endpoint-independent mapping from a
 * port-dependent one, which is what decides whether two browsers talk directly or need a relay.
 *
 * The browser may also say which reflexive address it was given. That is never used to look the
 * store up — asking about an address is asking about whoever is behind it — only compared with the
 * address this page came over, which is the interesting half anyway.
 */
export class ProbeNat {
  constructor(
    private readonly bindings: NatBindings,
    private readonly servers: StunEndpoint[],
  ) {}

  report(visitorIp: string, browser: ClaimedAddress[] = []): NatReport {
    const ip = plainIp(visitorIp);
    const sightings = this.bindings.forAddress(ip);
    const views = group(sightings);
    const mapping = mappingOf(sightings);
    const elsewhere = browser.filter((c) => plainIp(c.address) !== ip);
    const matchesHttp = views.length ? true : browser.length ? elsewhere.length < browser.length : null;
    return {
      you: { ip },
      servers: this.servers,
      sightings: views,
      browser,
      mapping,
      matchesHttp,
      pending: views.length === 0 && browser.length === 0,
      ...judge(views, mapping, elsewhere, ip),
    };
  }
}

/** One entry per reflexive port, listing the sockets of ours that saw it. */
function group(sightings: StunSighting[]): StunView[] {
  const byPort = new Map<number, StunView>();
  for (const s of sightings) {
    const view = byPort.get(s.port);
    if (view) {
      if (!view.serverPorts.includes(s.serverPort)) view.serverPorts.push(s.serverPort);
      view.software ??= s.software;
    } else {
      byPort.set(s.port, { port: s.port, serverPorts: [s.serverPort], software: s.software, at: s.at });
    }
  }
  return [...byPort.values()];
}

/**
 * The same reflexive port on two of our sockets means the mapping does not depend on the
 * destination; different ports with nothing in common mean it does. A browser can gather from
 * several local sockets at once, so this compares the sets instead of counting ports.
 */
function mappingOf(sightings: StunSighting[]): NatMapping {
  const bySocket = new Map<number, Set<number>>();
  for (const s of sightings) {
    const ports = bySocket.get(s.serverPort) ?? new Set<number>();
    ports.add(s.port);
    bySocket.set(s.serverPort, ports);
  }
  const sockets = [...bySocket.values()];
  if (sockets.length < 2) return "desconhecido";
  const shared = [...sockets[0]].filter((port) => sockets.every((ports) => ports.has(port)));
  return shared.length ? "porta-fixa" : "porta-por-destino";
}

function judge(
  views: StunView[],
  mapping: NatMapping,
  elsewhere: ClaimedAddress[],
  ip: string,
): Pick<NatReport, "verdict" | "headline" | "detail"> {
  // Another family is the everyday dual-stack case, not a leak: these sockets only speak IPv4,
  // so a page served over IPv6 is answered from the visitor's IPv4 and the two never match.
  const sameFamily = elsewhere.filter((c) => ipVersion(c.address) === ipVersion(ip));
  if (!views.length && sameFamily.length)
    return {
      verdict: "contradicao",
      headline: `o navegador foi atendido em ${sameFamily[0].address}, não em ${ip}`,
      detail:
        "Esta página chegou por um endereço e o UDP saiu por outro, e nada chegou aqui vindo do primeiro. Numa VPN, é o tráfego UDP escapando por fora dela; também acontece com CGNAT e com redes que tratam TCP e UDP por caminhos diferentes.",
    };
  if (!views.length && elsewhere.length)
    return {
      verdict: "info",
      headline: `você veio por IPv${ipVersion(ip)} e o UDP saiu por IPv${ipVersion(elsewhere[0].address)}`,
      detail: `Esta página chegou de ${ip} e o STUN atendeu ${elsewhere[0].address}: é a sua pilha dupla escolhendo caminhos diferentes para TCP e UDP, não um vazamento. Estes sockets só falam IPv4.`,
    };
  if (!views.length)
    return {
      verdict: "info",
      headline: "nenhuma requisição STUN chegou ainda",
      detail:
        "O WebRTC pode estar desligado no navegador, uma extensão pode tê-lo bloqueado, ou o UDP não está saindo da sua rede. Se o navegador diz ter sido atendido, a resposta pode ter vindo de outra réplica deste servidor: cada uma guarda só o que ela mesma viu.",
    };
  const ports = views.map((v) => v.port).join(", ");
  if (mapping === "porta-por-destino")
    return {
      verdict: "ok",
      headline: "seu NAT troca a porta a cada destino",
      detail: `Cada socket deste servidor viu uma porta diferente (${ports}): é o NAT simétrico. Ninguém adivinha por onde você fala com outro destino, mas uma chamada ponto a ponto com você precisa de um relay (TURN).`,
    };
  if (mapping === "porta-fixa")
    return {
      verdict: "info",
      headline: `seu NAT mantém a porta ${ports} para destinos diferentes`,
      detail:
        "Os dois sockets deste servidor viram a mesma porta: o mapeamento não depende do destino. É o que faz chamada e jogo ponto a ponto funcionarem sem relay, e também o que permite a qualquer servidor que você contate devolver pacotes por esse mesmo buraco enquanto ele durar.",
    };
  return {
    verdict: "info",
    headline: `um socket deste servidor viu você em ${ports}`,
    detail:
      "Só um dos dois foi alcançado, então não dá para comparar os mapeamentos. O outro pode estar bloqueado no caminho, ou a coleta de candidatos parou antes de chegar nele.",
  };
}
