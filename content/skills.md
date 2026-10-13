---
# Skills da página /sobre. Cada uma lista onde aparece de verdade; skill sem prova fica de fora.
# action.type: exp (experiência no /sobre) · proj (abre o projeto) · run (comando no terminal)
#              page (outra página) · live (painel Ao vivo) · link (URL externa)
groups:
  - title: Backend
    items:
      - name: Node.js
        evidence:
          - where: RotaExata
            text: APIs em Express e NestJS para uma plataforma de rastreamento veicular e gestão de frotas.
            action: { type: exp, label: ver experiência }
          - where: este site
            text: A API que responde o terminal, os cards e o Ao vivo.
            action: { type: run, target: curl /api/status, label: rodar curl }
      - name: TypeScript
        evidence:
          - where: RotaExata
            text: Todas as APIs do rastreamento são escritas em TypeScript.
            action: { type: exp, label: ver experiência }
          - where: este site
            text: API em camadas domain / application / infrastructure / http, com teste de arquitetura.
            action: { type: link, target: "https://github.com/Guilherme-b-damasio/portfolio/tree/develop/src", label: ver código }
      - name: PHP
        evidence:
          - where: UltraLIMS
            text: APIs REST com Slim Framework e rotinas de cálculo críticas de um sistema LIMS.
            action: { type: exp, label: ver experiência }
      - name: APIs REST
        evidence:
          - where: UltraLIMS
            text: APIs REST com Slim Framework, organizadas por módulos.
            action: { type: exp, label: ver experiência }
          - where: este site
            text: Rotas públicas de perfil, projetos, perguntas e status.
            action: { type: run, target: curl /api/projects, label: rodar curl }
  - title: Cloud e eventos
    items:
      - name: SQS e SNS
        evidence:
          - where: RotaExata
            text: Arquitetura orientada a eventos processando milhões de posições de rastreadores por dia, com reprocessamento resiliente.
            action: { type: exp, label: ver experiência }
      - name: AWS Lambda
        evidence:
          - where: RotaExata
            text: Funções serverless para cargas assíncronas e integrações, com foco em escalabilidade e custo.
            action: { type: exp, label: ver experiência }
      - name: IoT
        evidence:
          - where: RotaExata
            text: Integrações com rastreadores, padronizando a ingestão e tratando falhas de comunicação.
            action: { type: exp, label: ver experiência }
  - title: Infra e DevOps
    items:
      - name: Kubernetes
        evidence:
          - where: RotaExata
            text: Manifests, gestão de secrets e deploy dos serviços em EKS/Rancher.
            action: { type: exp, label: ver experiência }
          - where: este site
            text: Roda num cluster k3s próprio, com deploy por GitOps (Flux).
            action: { type: live, label: ver ao vivo }
      - name: Docker
        evidence:
          - where: este site
            text: Imagem construída no CI a partir do Dockerfile do repositório.
            action: { type: link, target: "https://github.com/Guilherme-b-damasio/portfolio/blob/develop/Dockerfile", label: ver Dockerfile }
      - name: GitHub Actions
        evidence:
          - where: RotaExata
            text: Pipelines de deploy dos serviços.
            action: { type: exp, label: ver experiência }
          - where: este site
            text: Testa, publica a imagem e o commit no ar aparece no rodapé.
            action: { type: link, target: "https://github.com/Guilherme-b-damasio/portfolio/tree/develop/.github/workflows", label: ver workflows }
  - title: IA aplicada
    items:
      - name: RAG
        evidence:
          - where: docsage
            text: Recuperação BM25 e resposta com fontes citadas.
            action: { type: proj, target: docsage, label: abrir projeto }
          - where: este site
            text: O comando ask é um RAG sobre este conteúdo.
            action: { type: run, target: 'ask "como funciona o docsage?"', label: rodar ask }
      - name: MCP
        evidence:
          - where: docsage
            text: Também roda como servidor MCP via stdio ou HTTP.
            action: { type: proj, target: docsage, label: abrir projeto }
          - where: este site
            text: Servidor MCP público com quatro ferramentas só de leitura.
            action: { type: page, target: mcp, label: abrir /mcp }
      - name: Claude API
        evidence:
          - where: docsage
            text: Gera a resposta citando os trechos recuperados.
            action: { type: proj, target: docsage, label: abrir projeto }
      - name: Agentes
        evidence:
          - where: clawd-tracker
            text: Mostra no teclado o que o Claude Code está fazendo, via hooks HTTP.
            action: { type: proj, target: clawd-tracker, label: abrir projeto }
  - title: Arquitetura e qualidade
    items:
      - name: Clean Architecture
        evidence:
          - where: UltraLIMS
            text: Rotinas de cálculo críticas com rastreabilidade dos resultados laboratoriais.
            action: { type: exp, label: ver experiência }
          - where: este site
            text: Portas e adaptadores, com main.ts como única raiz de composição.
            action: { type: link, target: "https://github.com/Guilherme-b-damasio/portfolio/blob/develop/CONTRIBUTING.md", label: ver padrão }
      - name: DDD
        evidence:
          - where: UltraLIMS
            text: Modelagem das rotinas de cálculo do sistema LIMS.
            action: { type: exp, label: ver experiência }
      - name: Testes
        evidence:
          - where: UltraLIMS
            text: PHPUnit em módulos legados, levando o coverage de 10% para 40%.
            action: { type: exp, label: ver experiência }
          - where: este site
            text: Testes com fakes para todo serviço externo; o CI barra o merge se falharem.
            action: { type: link, target: "https://github.com/Guilherme-b-damasio/portfolio/tree/develop/tests", label: ver testes }
      - name: Observabilidade
        evidence:
          - where: RotaExata
            text: Erros e logs no Sentry, reduzindo o tempo até a correção de incidentes.
            action: { type: exp, label: ver experiência }
          - where: este site
            text: Métricas por rota, formato Prometheus e logs em JSON com id por requisição.
            action: { type: run, target: curl /metrics, label: rodar curl }
---
