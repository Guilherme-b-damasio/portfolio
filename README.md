# portfolio

Personal site where the site itself is the showcase: a Node/TypeScript API with a
BM25 + Claude RAG that answers questions about me, a terminal UI that talks to that
API, and live metrics (`/api/status`, Prometheus at `/metrics`). Runs on k3s.

```bash
npm install
npm run dev          # http://localhost:3000
npm test
```

Content lives in `content/` as Markdown: `profile.md` plus one file per project in
`content/projects/`. Each `## ` heading becomes one searchable chunk; sections that
still start with `TODO` are left out of the index.

| Env var             | Default           | Purpose                                              |
| ------------------- | ----------------- | ---------------------------------------------------- |
| `PORT`              | `3000`            |                                                      |
| `ANTHROPIC_API_KEY` | unset             | Enables generated answers; without it `/api/ask` returns only the retrieved passages |
| `CLAUDE_MODEL`      | `claude-opus-5-5` | Model used by `/api/ask`                             |
| `GIT_SHA`, `BUILT_AT` | `dev`           | Shown in the footer and `/api/status` (set as Docker build args) |

## API

| Route                     | Notes                                       |
| ------------------------- | ------------------------------------------- |
| `GET /api/profile`        |                                             |
| `GET /api/projects?tag=`  | Without bodies                              |
| `GET /api/projects/:slug` |                                             |
| `POST /api/ask`           | `{ question }`, 5 per client, refills 5/min |
| `GET /api/status`         | Uptime, memory, pod/node, p50/p95 per route |
| `GET /metrics`            | Prometheus text format                      |
| `GET /healthz`            | Probes                                      |

## Deploy (k3s)

```bash
docker build -t ghcr.io/<user>/portfolio:$(git rev-parse --short HEAD) \
  --build-arg GIT_SHA=$(git rev-parse HEAD) --build-arg BUILT_AT=$(date -u +%FT%TZ) .
kubectl create secret generic portfolio-secrets -n portfolio --from-literal=anthropic-api-key=...
kubectl apply -f k8s/deployment.yaml
```

Fill the `TODO`s in `k8s/deployment.yaml` (image registry, host, TLS issuer).
