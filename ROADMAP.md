# Roadmap

## Onde estamos

O MVP funciona localmente, mas ainda é um protótipo:

- **Nunca rodou fora da máquina local.** O `docker build` não foi testado, não há CI nem deploy.
- **O conteúdo é quase todo `TODO`.** O RAG responde sobre placeholders.
- **O chat é opaco.** A resposta chega de uma vez, não tem follow-up, o BM25 roda sobre uns 10 trechos e o docsage não entra.
- **As métricas morrem com o pod.** Ficam na memória do processo e só mostram o próprio pod.
- **Não há proteção de custo.** Nada impede que um bot gaste a cota da Claude API: o rate limit é por IP e não existe teto diário.
- **A única parte interativa é o terminal.** O resto da página é estático.

## Princípios

1. **Cada funcionalidade prova uma habilidade de backend, infra ou IA com dados reais.** Mock só nos testes.
2. **Tem que caber no VPS.** O orçamento do portfólio no cluster é de ~300 MB de RAM no total. Nada de Prometheus + Grafana completos.
3. **Segue o padrão do `devdek-infra`.** Flux, GHCR com tag `<timestamp>-<sha>`, cert-manager com `letsencrypt-teste` antes de `letsencrypt`.
4. **Tudo que o visitante dispara tem limite no servidor:** taxa, concorrência, timeout e custo.

---

## Fase 0: no ar

Sem isso, nenhuma funcionalidade nova importa: ninguém vê.

| # | Item | Pronto quando | Tam. |
|---|------|---------------|------|
| 0.1 | Conteúdo real: bio e 3 a 5 projetos com "Decisões técnicas" e "O que aprendi" | Nenhum `TODO` no índice | M (você escreve, eu reviso) |
| 0.2 | CI no GitHub Actions: typecheck, testes, build e push para `ghcr.io/guilherme-b-damasio/portfolio:<ts>-<sha>` | Push na `main` publica a imagem | P |
| 0.3 | Entrar no `devdek-infra`: `apps/portfolio/` (deployment, service, ingress) com o setter `$imagepolicy`, mais `ImageRepository`/`ImagePolicy` em `clusters/producao/imagens.yaml`. O `ImageUpdateAutomation` já cobre `./apps`. A pasta `k8s/` sai deste repo, porque a fonte da verdade passa a ser o infra | O Flux reconcilia e o pod fica Ready | P |
| 0.4 | DNS e TLS: registro A para `92.222.86.151`, primeiro com `letsencrypt-teste` e depois com `letsencrypt` | HTTPS válido | P |
| 0.5 | Proteção: headers de segurança e CSP, teto de concorrência no `/api/ask` e **orçamento diário de tokens**. Ao bater o teto, o chat volta a só recuperar trechos, e o terminal avisa | Teste cobre o corte por orçamento | P |
| 0.6 | Smoke test e2e com Playwright no CI: abre a página, roda `ask` e confere `status` | Roda a cada PR | P |

**Entrega:** URL pública com HTTPS e deploy automático a cada push na `main`.

---

## Fase 1: IA à mostra

O objetivo é um chat que explica a si mesmo.

| # | Item | Detalhe | Tam. |
|---|------|---------|------|
| 1.1 | Streaming | `/api/ask` passa a usar SSE, e os tokens chegam no terminal enquanto são gerados | P |
| 1.2 | `ask --xray` | Mostra cada etapa ao vivo: tokenização, ranking BM25 com o score de cada trecho, o prompt exato que foi montado (colapsável) e a geração, com tokens/s e custo estimado em US$ | M |
| 1.3 | Conversa e citações | Follow-up com memória curta guardada no cliente. Citações clicáveis abrem `cat projeto#seção` | P |
| 1.4 | docsage como motor | Serviço no cluster (HTTP fino sobre `search --json`) e um `HttpRetriever` que cai para o BM25 local se o serviço cair. `ask --engine docsage\|local` compara os dois lado a lado | M |
| 1.5 | Eval do RAG | ~20 perguntas com a fonte esperada. O CI falha se o recall@3 cair. A página `/evals` mostra o histórico | M |

---

## Fase 2: infra à mostra

O objetivo é o visitante ver o caminho do commit até o pod.

| # | Item | Detalhe | Tam. |
|---|------|---------|------|
| 2.1 | Tracing | OpenTelemetry no Node e `x-trace-id` em toda resposta. Os spans ficam num buffer em memória (sem Jaeger). `trace <id>`, ou clicar num comando já executado, abre o waterfall http → bm25 → claude | M |
| 2.2 | Mapa do cluster ao vivo | ServiceAccount só leitura (RBAC `get/list` em pods, nodes e deployments de uma whitelist de namespaces) mais `metrics.k8s.io`, já que o metrics-server vem no k3s. Mostra node, namespaces e pods com CPU, memória, restarts e idade. Comando `kubectl get pods` | M |
| 2.3 | Histórico de métricas | VictoriaMetrics single-node (~50 MB) raspando `/metrics`, ou um ring buffer de 24h no processo se a RAM estiver curta. Sparklines no painel "Ao vivo" | M |
| 2.4 | Linha do tempo de deploy | API do GitHub (commit e run do Actions) cruzada com os eventos do Flux, vistos pela API do cluster: commit → imagem → Flux aplicou → pod pronto, com a duração de cada etapa. Comando `deploys` | M |

---

## Fase 3: playgrounds

| # | Item | Detalhe | Tam. |
|---|------|---------|------|
| 3.1 | Laboratório de rate limit | Balde de tokens do visitante desenhado a partir dos headers reais. O botão "dispara 10" mostra os 429 chegando e o balde enchendo de novo | P |
| 3.2 | Laboratório de carga controlada | O visitante escolhe até 200 requisições contra um endpoint sandbox. O servidor executa com concorrência limitada e **uma corrida por vez no total**, com fila visível. A latência aparece ao vivo via SSE (percentis, backpressure) | M |
| 3.3 | Playground de busca | Sliders de `k1`, `b` e top-k, com o ranking se reordenando ao vivo. Comparação BM25 × docsage | P |
| 3.4 | Servidor MCP público | `/mcp` em Streamable HTTP, só leitura, com as ferramentas `profile`, `projects` e `search`. A página mostra o `claude mcp add --transport http portfolio https://…/mcp`, e quem quiser conecta o próprio Claude ao portfólio | P |
| 3.5 | Diagrama de arquitetura vivo | SVG do sistema em que cada requisição real acende o caminho que percorreu (eventos via SSE) | M |

---

## Fase 4: polimento

- **Terminal:** autocomplete com Tab, `man <cmd>`, pipes simples (`| grep`, `| jq .campo`), histórico salvo, Ctrl+L.
- **Tema:** alternância entre claro e escuro, mais uma versão em inglês (o RAG já responde na língua da pergunta).
- **Qualidade:** imagem de compartilhamento (OG), SEO básico, terminal acessível por teclado e Lighthouse ≥ 95.

---

## Ordem sugerida

Fase 0 inteira → 1.1 + 1.2 → 3.4 → 2.2 → 3.1 → 2.1 → resto.

Depois do deploy, o raio-x e o MCP dão o maior efeito pelo menor esforço, e o mapa do cluster é o que mais diferencia na parte de infra.

## Decisões em aberto

1. **Domínio:** próprio ou subdomínio do `devdek.online`?
2. **RAM livre no VPS:** define se docsage e VictoriaMetrics cabem.
3. **LLM:** modelo e teto mensal de gasto. Opus 5.5 dá respostas melhores; Haiku 5.5 é muito mais barato por pergunta.
4. **Idioma:** só português, ou bilíngue desde já?
5. **Repositório público?** Recomendo que sim: o código faz parte do portfólio.
