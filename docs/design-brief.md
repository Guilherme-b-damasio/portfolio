# Briefing de design: portfólio do Guilherme Damasio

Este documento é para quem vai desenhar o site. Ele descreve o que existe hoje, os dados
reais que cada parte mostra, o que vem pela frente e as restrições técnicas que o design
precisa respeitar.

## A ideia em uma frase

O próprio site é a peça principal do portfólio. Em vez de uma página contando que eu sei
backend, infra e IA, o visitante usa uma API real, um RAG real e vê métricas reais do
servidor (um cluster k3s numa VPS) enquanto navega.

## Para quem

- **Recrutadores e gestores técnicos**, que passam 30 a 60 segundos na página. Precisam
  entender em uma rolada quem eu sou, o que faço e que isso aqui é de verdade.
- **Engenheiros**, que vão abrir o terminal, rodar comandos, olhar latência e ler o código
  no GitHub. Esses ficam mais tempo e querem detalhe.

O design precisa servir aos dois: uma camada de leitura rápida por cima e profundidade
para quem quiser cavar.

## Personalidade

- Técnico, sóbrio e confiante. Mais "painel de operação bem feito" do que "landing page".
- O terminal é o elemento de assinatura, mas o resto da página não precisa parecer um
  terminal. Hoje: texto em Inter, código e dados em JetBrains Mono.
- Os números ao vivo são prova, não decoração: precisam ser legíveis e parecer confiáveis.
- Cor de destaque atual: verde (`#0f7a55` no claro, `#5fe0a8` no escuro). Pode mudar.

## Estrutura atual da página (uma página só)

### 1. Topo

- Linha pequena com a função: `Backend · Infra · IA`
- Nome, em destaque
- Uma frase explicando que o site é um dos projetos
- Links: GitHub, LinkedIn, e-mail (vêm da API; os que ainda não existem não aparecem)

### 2. Terminal

Uma janela de terminal com barra de título (`guest@portfolio: ~`), área de saída e campo
de comando. Abaixo dela, botões de sugestão ("chips") que executam comandos com um clique.

| Comando | O que mostra |
| --- | --- |
| `help` | Lista de comandos |
| `whoami` | Nome, função, local e o texto "Sobre" |
| `ls projects` | Um projeto por linha: slug + resumo |
| `cat <projeto>` | Nome, stack, texto completo do projeto e link do repo |
| `ask "<pergunta>"` | Resposta do RAG (ver abaixo) |
| `status` | Pod, uptime, memória, req/min, modelo de IA, commit |
| `curl <caminho>` | Resposta crua da API: status HTTP, tempo, content-type e JSON formatado |
| `clear` | Limpa a tela |

Setas ↑/↓ navegam no histórico.

**Saída do `ask`** (o momento mais importante do site):

1. Uma linha "buscando trechos…" enquanto espera.
2. A resposta escrita pelo Claude, com fontes citadas entre colchetes, como
   `[docsage.md › Decisões técnicas]`. **Hoje o LLM está desligado em produção**, então
   aparece o aviso "(LLM desligado neste ambiente: mostrando só a recuperação)".
3. Os trechos recuperados, cada um com score (ex.: `4.21`), a fonte e até 280 caracteres
   de texto, com **as palavras da pergunta destacadas** dentro do trecho.
4. Uma linha de rodapé com números, por exemplo: `bm25 0.4ms · claude-opus-5-5 1830ms · 812→96 tokens · total 1902ms · rate limit restante 4`.

Estados que precisam de desenho no terminal: carregando, resposta normal, nenhum trecho
encontrado, LLM desligado, erro, comando não encontrado e **limite de perguntas atingido**
(HTTP 429, "Muitas perguntas seguidas. Tenta de novo em instantes."). O limite é 5
perguntas por visitante, recarregando 5 por minuto.

### 3. Projetos

Uma grade de cards. Cada card tem nome, resumo de uma linha, tags de stack, um botão
"abrir no terminal" (roda `cat <projeto>` e rola até o terminal) e um link "repo"
quando existe.

Exemplo real de um projeto (`GET /api/projects`):

```json
{
  "slug": "docsage",
  "name": "docsage",
  "summary": "RAG em Python para perguntar coisas aos seus próprios documentos, com citações.",
  "stack": ["Python", "BM25", "Claude API", "MCP"],
  "tags": ["ia", "rag", "cli"],
  "repo": "https://github.com/Guilherme-b-damasio/docsage",
  "order": 1
}
```

São 3 projetos hoje (docsage, clawd-tracker, devdek); o plano é chegar a 3–5. O texto
completo de cada um tem seções como "O que é", "Decisões técnicas" e "O que aprendi".

### 4. Ao vivo

Atualiza a cada 5 segundos a partir de `GET /api/status`:

- Quatro números grandes: **uptime**, **requests no último minuto**, **memória (MB)** e o
  **pod** que atendeu (com o nome do nó do cluster).
- Uma tabela por rota da API: rota, nº de requests, latência p50, latência p95 e erros.

Exemplo (resumido, valores ilustrativos):

```json
{
  "uptimeSeconds": 29,
  "requestsLastMinute": 2,
  "memory": { "rssMb": 65, "heapUsedMb": 15 },
  "runtime": { "node": "v20.20.2", "pod": "portfolio-7b48f5bb74-gpz4s", "node_name": "vps-…", "namespace": "portfolio" },
  "build": { "commit": "0e76b34…", "builtAt": "2026-10-13T11:35:02Z" },
  "routes": [{ "route": "GET /api/projects", "count": 12, "errors": 0, "p50Ms": 1.9, "p95Ms": 6.3 }],
  "llm": null
}
```

### 5. Rodapé

`build 0e76b34 · node v20.20.2`: o commit que está rodando agora.

## O que vem pela frente (o design deve deixar espaço)

Na ordem do roadmap. Não precisa desenhar tudo em detalhe, mas a estrutura da página
precisa comportar essas peças sem virar uma bagunça.

**IA à mostra**
- Resposta do `ask` aparecendo **token a token** enquanto é gerada (streaming).
- `ask --xray`: a mesma pergunta mostrada como um pipeline em etapas: tokenização →
  ranking BM25 com scores → prompt montado → geração com tokens/s e custo em US$.
- Conversa com follow-up (memória curta).
- Citações clicáveis que abrem o projeto citado na seção certa.
- Escolha do motor de busca: `local` ou `docsage`.
- Página `/evals` com a qualidade do RAG (recall@3 em ~20 perguntas).

**Infra à mostra**
- `trace <id>`: um gráfico em cascata (waterfall) com o tempo de cada etapa de uma
  requisição. Clicar num comando já executado abre o trace dele.
- Painel **Cluster**: nó, pods, CPU/memória, restarts e idade de cada pod.
- **Sparklines** de 24h nos números do "Ao vivo".
- `deploys`: linha do tempo commit → imagem → Flux → pod pronto.

**Playgrounds**
- Laboratório de rate limit: um "balde de fichas" visual com botão "dispara 10".
- Playground de busca com sliders (`k1`, `b`, top-k) e o ranking se reordenando ao vivo.
- Teste de carga controlado (até 200 requisições, uma corrida por vez, fila visível).
- **Diagrama de arquitetura vivo**: um SVG em que cada requisição real acende o caminho
  que percorreu (ingress → API → BM25 → Claude…).
- Instruções para conectar o servidor MCP do site no Claude (`claude mcp add …`).

**Polimento**
- Autocomplete com Tab e `man <cmd>` no terminal; pipes (`| grep`, `| jq`).
- **Botão de tema claro/escuro.**
- Versão em inglês.
- Imagem de compartilhamento (Open Graph).

## Restrições técnicas (importantes)

- **HTML, CSS e JavaScript puros, sem framework e sem build.** Nada de React, Tailwind
  compilado ou bibliotecas de componentes. O CSS usa variáveis (`--bg`, `--ink`,
  `--accent`, `--term-bg`…) e o design deve ser entregue nesse formato: uma lista de
  tokens de cor, tipografia e espaçamento mais os componentes.
- **Claro e escuro** são obrigatórios, seguindo o sistema e com alternância manual.
- **Funciona a partir de 375px de largura.** O terminal precisa ser usável no celular:
  as sugestões clicáveis importam mais lá do que digitar.
- **Acessível**: usável só com teclado e com leitor de tela; meta Lighthouse ≥ 95.
- **Leve**: o servidor é uma VPS pequena. Sem vídeos de fundo, sem imagens pesadas, no
  máximo duas famílias de fonte.
- Todo texto vindo da API é inserido como texto puro, nunca como HTML. Formatação rica
  dentro do terminal (negrito, links, destaque) é feita com elementos simples.

## Conteúdo

O texto pessoal (bio, histórias dos projetos) **ainda está sendo escrito**; vários
trechos hoje dizem `TODO`. Use os textos acima como referência de tamanho e tom, mas não
dependa deles: o layout precisa funcionar com bio de 2–3 parágrafos e projetos com 3–4
seções curtas.

## O que eu espero receber

1. Direção visual: paleta (claro e escuro), tipografia e espaçamentos como tokens.
2. A página inteira em desktop e em 375px.
3. O terminal em detalhe, com todos os estados do `ask` listados acima.
4. Card de projeto e painel "Ao vivo", incluindo como as sparklines entrariam.
5. Uma proposta de onde encaixar o painel Cluster, o trace em cascata e o diagrama vivo.
