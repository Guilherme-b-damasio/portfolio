import type { ManualLibrary, ManualPage } from "../../domain/manual.js";

// The manual of the terminal, in the order `man` lists it. Text only: what each command needs to
// answer is a capability name, and whether this server has it is decided outside this file.
const PAGES: ManualPage[] = [
  {
    name: "help",
    summary: "a lista de comandos, numa linha cada",
    synopsis: ["help"],
    description: "Mostra todos os comandos com uma descrição curta. É o atalho; o manual de um comando sai no man.",
    seeAlso: ["man"],
  },
  {
    name: "man",
    summary: "o manual de um comando, lido do servidor",
    synopsis: ["man", "man <comando>"],
    description:
      "Sem argumento, lista as páginas do manual. Com um comando, mostra a página dele: para que serve, as opções e exemplos que você pode rodar clicando. As páginas vêm de GET /api/man neste servidor, então uma página avisa quando o comando está desligado aqui — por falta de uma chave, de uma porta UDP ou de acesso ao cluster.",
    examples: ["man ask", "man kubectl", "curl /api/man"],
    seeAlso: ["help", "curl"],
  },
  {
    name: "whoami",
    summary: "quem eu sou, do mesmo conteúdo que alimenta o RAG",
    synopsis: ["whoami"],
    description:
      "Lê GET /api/profile: o perfil em Markdown de content/, partido por seção. É a mesma fonte que o ask recupera, então o que você lê aqui é o que o modelo tem para responder.",
    seeAlso: ["ls", "cat", "ask"],
  },
  {
    name: "ls",
    summary: "lista os projetos",
    synopsis: ["ls", "ls projects"],
    description: "Lê GET /api/projects. Cada slug é um botão que roda cat naquele projeto.",
    examples: ["ls projects"],
    seeAlso: ["cat"],
  },
  {
    name: "cat",
    summary: "um projeto inteiro, ou só a seção citada",
    synopsis: ["cat <projeto>", "cat <projeto> <seção>"],
    description:
      "Lê GET /api/projects/<slug> e imprime as seções do Markdown. Com uma seção, mostra só ela: é por aí que as citações do ask abrem o trecho exato que o modelo usou.",
    examples: ["cat docsage", "ls projects"],
    seeAlso: ["ls", "ask"],
  },
  {
    name: "ask",
    summary: "pergunta ao RAG sobre mim, com os trechos à vista",
    synopsis: ['ask "<pergunta>"', 'ask [--xray] [--new] [--engine docsage|local] "<pergunta>"'],
    description:
      "Manda a pergunta para POST /api/ask com Accept: text/event-stream, então a resposta aparece token a token. O servidor recupera trechos do conteúdo (BM25 por padrão), monta o prompt com eles e pede a resposta ao Claude; as citações viram botões que abrem o trecho citado. Cada visitante tem um balde de fichas, o servidor tem um teto de perguntas simultâneas e um orçamento diário de tokens: estourado o orçamento, você continua vendo a recuperação, sem geração.",
    options: [
      { flag: "--xray", text: "mostra tokenização, ranking BM25 com scores, o prompt exato e tokens/s com custo" },
      { flag: "--new", text: "esquece a conversa anterior e começa outra" },
      { flag: "--engine docsage|local", text: "busca no docsage (MCP) em vez do índice local" },
    ],
    examples: ['ask "o que é o docsage?"', 'ask --xray "como você trabalha em time?"'],
    seeAlso: ["search", "trace", "status"],
    needs: {
      capability: "llm",
      text: "sem ANTHROPIC_API_KEY neste servidor: o ask recupera os trechos e não gera resposta",
    },
  },
  {
    name: "status",
    summary: "métricas ao vivo deste processo",
    synopsis: ["status"],
    description:
      "Lê GET /api/status: pod e nó, uptime, memória RSS, requisições no último minuto, o modelo ligado, quanto do orçamento diário de tokens já foi e o commit que está no ar. São contadores em memória deste pod, não um banco.",
    examples: ["status", "curl /api/status"],
    seeAlso: ["kubectl", "deploys", "load"],
  },
  {
    name: "kubectl",
    summary: "os pods e o nó do cluster, só leitura",
    synopsis: ["kubectl get pods [-n <ns> | -A]", "kubectl get nodes"],
    description:
      "Chama a API do Kubernetes com a service account deste pod, que só tem get e list numa lista fechada de namespaces (k8s/rbac.yaml). Qualquer outro verbo é recusado aqui mesmo. O nó vem com CPU e memória do metrics-server e o servidor guarda 5 s de cache.",
    options: [
      { flag: "-n <ns>", text: "um namespace da whitelist" },
      { flag: "-A", text: "todos os namespaces visíveis" },
    ],
    examples: ["kubectl get pods", "kubectl get nodes"],
    seeAlso: ["deploys", "status"],
    needs: {
      capability: "cluster",
      text: "este processo não está num cluster: não há service account para ler a API do Kubernetes",
    },
  },
  {
    name: "deploys",
    summary: "commit → imagem → tag → Flux → pod pronto",
    synopsis: ["deploys"],
    description:
      "Junta duas fontes pelo sha: as execuções do workflow Image na API pública do GitHub (sem token, com cache de 5 min) e os ReplicaSets do deployment no cluster, mais os eventos do ImagePolicy do Flux para saber quando a tag nova foi escolhida. Cada etapa diz sozinha se respondeu.",
    examples: ["deploys"],
    seeAlso: ["kubectl", "status"],
    needs: { capability: "deploys", text: "nenhuma das fontes de deploy está ligada neste servidor" },
  },
  {
    name: "ratelimit",
    summary: "esvazia um balde de tokens de verdade no servidor",
    synopsis: ["ratelimit", "ratelimit <n>"],
    description:
      "Sem argumento, lê o seu balde em GET /api/lab/ratelimit/bucket. Com n (até 10), dispara n requisições contra a rota limitada e imprime o status com os headers x-ratelimit-remaining, x-ratelimit-reset e retry-after de cada uma. O balde é por visitante e vive no servidor; o navegador só lê os headers.",
    examples: ["ratelimit", "ratelimit 10"],
    seeAlso: ["load", "ask"],
  },
  {
    name: "load",
    summary: "uma corrida de carga controlada, saindo do próprio pod",
    synopsis: ["load", "load <n> [c] [--target healthz|projects|status]"],
    description:
      "POST /api/lab/load dispara n requisições (até 200), c por vez, contra uma rota deste mesmo processo em loopback, e devolve cada amostra por SSE: a faixa de latência cresce ao vivo e no fim saem p50, p95, p99 e req/s. Só uma corrida acontece por vez no servidor inteiro; as outras entram numa fila visível e a corrida morre no limite de 30 s.",
    options: [{ flag: "--target <nome>", text: "a rota alvo: healthz, projects ou status" }],
    examples: ["load 50 5", "load 100 10 --target projects"],
    seeAlso: ["status", "ratelimit"],
    needs: { capability: "loadLab", text: "o laboratório de carga está desligado neste servidor" },
  },
  {
    name: "search",
    summary: "o ranking BM25 ao vivo, com k1, b e top-k nas suas mãos",
    synopsis: ['search "<consulta>"'],
    description:
      "Abre o playground de busca: os sliders mandam k1, b e k para GET /api/lab/search e o ranking volta reordenado do servidor, sobre o mesmo índice que o ask usa. Serve para ver na prática o que a saturação de termo (k1) e a normalização por tamanho (b) fazem com os seus documentos.",
    examples: ['search "kubernetes flux"'],
    seeAlso: ["ask", "cat"],
    needs: { capability: "searchLab", text: "o playground de busca está desligado neste servidor" },
  },
  {
    name: "trace",
    summary: "o waterfall de uma requisição que já aconteceu",
    synopsis: ["trace", "trace <id>"],
    description:
      "Cada resposta da API traz um x-trace-id; GET /api/traces/<id> devolve as etapas daquela requisição, com duração e atributos, e aqui elas saem como um waterfall. Sem id, usa a última requisição que o terminal fez. Clicar num comando já executado também abre o trace dele. O buffer é em memória e guarda as últimas centenas de requisições.",
    examples: ["trace"],
    seeAlso: ["ask", "status"],
    needs: { capability: "traces", text: "este servidor está sem buffer de traces" },
  },
  {
    name: "scan",
    summary: "o que este site sabe sobre você, e onde você se contradiz",
    synopsis: ["scan"],
    description:
      "O navegador manda uma sonda (telas, fuso, GPU, idiomas) para POST /api/scan e o servidor cruza isso com a rede e o HTTP: IP e DNS reverso, de quem é a faixa, ordem crua dos headers, fingerprint TLS (JA4) e HTTP/2 quando a conexão passa pelo listener próprio. O interessante são as contradições: UA de Chrome com handshake de Python, fuso falsificado pela metade, GPU impossível para o sistema. Nada é guardado.",
    examples: ["scan", "open voce"],
    seeAlso: ["dnsleak", "stun", "open"],
  },
  {
    name: "dnsleak",
    summary: "qual resolvedor DNS você usa de verdade",
    synopsis: ["dnsleak"],
    description:
      "O servidor emite um nome aleatório na zona que ele mesmo responde (servidor DNS autoritativo próprio em UDP), a página resolve esse nome e depois GET /api/dns-leak conta quem perguntou: o resolvedor do seu provedor, o da sua VPN ou os dois — é assim que um vazamento de DNS aparece. Só nomes emitidos são registrados e há teto global de consultas.",
    examples: ["dnsleak"],
    seeAlso: ["scan", "stun"],
    needs: {
      capability: "dnsLeak",
      text: "falta delegar a zona (DNS_LEAK_ZONE) e expor 53/udp: o teste está desligado aqui",
    },
  },
  {
    name: "stun",
    summary: "como o seu NAT te mapeia, medido por dois sockets UDP",
    synopsis: ["stun"],
    description:
      "O navegador junta candidatos ICE contra os dois servidores STUN deste pod (RFC 8489 em node:dgram) e GET /api/stun conta o que cada socket viu: o seu IP público real, a porta de saída e se o NAT usa a mesma porta para os dois destinos ou uma nova para cada um. Compara também com o IP desta página, que é o que o HTTP mostra.",
    examples: ["stun"],
    seeAlso: ["scan", "dnsleak"],
    needs: { capability: "stun", text: "as portas UDP do STUN não estão abertas neste servidor" },
  },
  {
    name: "curl",
    summary: "chama a API crua e imprime a resposta",
    synopsis: ["curl <caminho>"],
    description:
      "Faz um GET no caminho e mostra status, tempo, content-type e o corpo. É a saída mais honesta do terminal: tudo que os outros comandos desenham sai dessas mesmas rotas.",
    examples: ["curl /api/profile", "curl /api/status", "curl /api/man"],
    seeAlso: ["man", "status"],
  },
  {
    name: "open",
    summary: "abre uma página do site",
    synopsis: ["open <página>"],
    description: "Navega para uma das páginas do site sem sair do terminal.",
    examples: ["open voce", "open projetos"],
    seeAlso: ["scan"],
  },
  {
    name: "clear",
    summary: "limpa a tela e esquece a conversa",
    synopsis: ["clear"],
    description: "Apaga a saída e zera o histórico de follow-up que o ask leva junto.",
    seeAlso: ["ask"],
  },
];

/** The manual as it ships with the image: fixed text, no I/O. */
export class StaticManualLibrary implements ManualLibrary {
  constructor(private readonly all: ManualPage[] = PAGES) {}

  pages(): ManualPage[] {
    return this.all;
  }

  page(name: string): ManualPage | undefined {
    const wanted = name.trim().toLowerCase();
    return this.all.find((p) => p.name === wanted);
  }
}
