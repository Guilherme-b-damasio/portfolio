# Roadmap

Site de portfólio em que o próprio site é a vitrine: uma API Node/TypeScript com RAG,
um terminal interativo e métricas ao vivo, rodando no k3s.

**Convenções**
- Marque o item com `[x]` na mesma feature branch que o entrega.
- **[dono]** = depende de decisão, credencial ou acesso que só o dono tem. O agente
  automático não faz esses itens. Ele pode preparar código ou documentação de apoio,
  mas não marca o item.
- Item grande demais para uma sessão vira sub-itens logo abaixo dele.

## Princípios

1. **Cada funcionalidade prova uma habilidade de backend, infra ou IA com dados reais.** Mock só nos testes.
2. **Tem que caber no VPS.** O orçamento do portfólio no cluster é de ~300 MB de RAM no total.
3. **O deploy segue o padrão do cluster existente.** Flux com automação de imagem, GHCR com
   tag `<timestamp>-<sha>`, cert-manager com o emissor de teste antes do de produção.
4. **Tudo que o visitante dispara tem limite no servidor:** taxa, concorrência, timeout e custo.

---

## 0.1 Fundação

- [x] Reorganizar `src/` em camadas (`domain/`, `application/`, `infrastructure/`, `http/`,
      `main.ts`), como no CONTRIBUTING. É só refactor: os testes continuam passando sem mudar de comportamento
- [ ] ESLint (flat config) + Prettier, com `npm run lint` no CI
- [ ] Logs estruturados em JSON, com id por requisição (`x-request-id`) e campos `route`, `status` e `ms`
- [ ] Headers de segurança e CSP sem `unsafe-inline` em scripts, com teste que confere os headers
- [ ] Teto de concorrência global no `/api/ask`: acima dele, 503 com `Retry-After`
- [ ] Orçamento diário de tokens do LLM (`LLM_DAILY_TOKEN_BUDGET`). Ao estourar, o chat cai para
      só-recuperação e o terminal avisa. Com testes
- [ ] Workflow que constrói a imagem e publica em `ghcr.io/guilherme-b-damasio/portfolio:<YYYYMMDDHHmmss>-<sha>`
      a cada push na `develop`, mais um `docker build` verificado no CI
- [ ] Smoke test e2e com Playwright no CI: abre a página, roda `help`, `ask` e `status`
- [ ] **[dono]** Conteúdo real em `content/`: bio e 3 a 5 projetos com "Decisões técnicas" e "O que aprendi"
- [ ] **[dono]** Domínio, DNS e TLS (emissor de teste primeiro)
- [ ] **[dono]** Registrar o app no repositório de infra (deployment, service, ingress, `ImageRepository`/`ImagePolicy`).
      O agente pode deixar os manifests prontos em `deploy/`, mas não mexe no repositório de infra
- [ ] **[dono]** Secret com a `ANTHROPIC_API_KEY` no cluster e o teto mensal de gasto definido

## 0.2 IA à mostra

- [ ] Streaming SSE no `/api/ask` (`text/event-stream`), com os tokens aparecendo no terminal enquanto são gerados
- [ ] `ask --xray`: mostra as etapas (tokenização → ranking BM25 com scores → prompt montado → geração
      com tokens/s e custo estimado em US$)
- [ ] Follow-up: conversa com memória curta guardada no cliente e enviada ao servidor com limite de tamanho
- [ ] Citações clicáveis que rodam `cat <projeto>` e rolam até a seção
- [ ] `HttpRetriever` para o docsage, com fallback para o BM25 local. `ask --engine docsage|local`
- [ ] Eval do RAG: ~20 perguntas com a fonte esperada e recall@3 calculado no CI (falha se cair)
- [ ] Página `/evals` com o resultado do último eval
- [ ] **[dono]** docsage rodando como serviço no cluster

## 0.3 Infra à mostra

- [ ] Tracing com spans num buffer em memória e `x-trace-id` na resposta. `trace <id>` mostra o waterfall
- [ ] Clicar num comando já executado no terminal abre o trace dele
- [ ] Porta `ClusterReader` + adapter da API do Kubernetes (só leitura, whitelist de namespaces) + fake para testes
- [ ] `kubectl get pods` e painel "Cluster": node, pods, CPU/memória (metrics-server), restarts, idade
- [ ] Manifests de RBAC só leitura em `deploy/` (Role/ClusterRole mínimos)
- [ ] Ring buffer de 24h das métricas no processo, com sparklines no painel "Ao vivo"
- [ ] `deploys`: linha do tempo commit → imagem → Flux → pod pronto (API do GitHub + eventos do cluster)

## 0.4 Playgrounds

- [ ] Laboratório de rate limit: balde de tokens do visitante a partir dos headers reais, com botão "dispara 10"
- [ ] Servidor MCP público em `/mcp` (Streamable HTTP, só leitura: `profile`, `projects`, `search`) + instrução
      `claude mcp add` na página
- [ ] Playground de busca: sliders de `k1`, `b` e top-k, com o ranking se reordenando ao vivo
- [ ] Laboratório de carga controlada: ≤ 200 requisições, uma corrida por vez no total, fila visível e latência via SSE
- [ ] Diagrama de arquitetura vivo: SVG em que cada requisição real acende o caminho que percorreu

## 0.5 Polimento

- [ ] Terminal: autocomplete com Tab e `man <cmd>`
- [ ] Terminal: pipes simples (`| grep`, `| jq .campo`) e histórico salvo
- [ ] Alternância de tema claro/escuro
- [ ] Versão em inglês (conteúdo bilíngue, `?lang=en`)
- [ ] Imagem de compartilhamento (OG), meta tags e `robots.txt`
- [ ] Acessibilidade: terminal usável só com teclado e leitor de tela; Lighthouse ≥ 95

## Qualidade (contínuo)

- [ ] Cobertura de testes por camada, com relatório no CI
- [ ] Dependabot para npm e GitHub Actions
