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
| `RESEND_API_KEY`, `CONTACT_TO` | unset | Turn on the contact form; messages go to `CONTACT_TO` through Resend |
| `CONTACT_FROM`      | `onboarding@resend.dev` | Sender shown in the e-mail (needs a verified domain on Resend to change) |

## API

| Route                     | Notes                                       |
| ------------------------- | ------------------------------------------- |
| `GET /api/profile`        |                                             |
| `GET /api/projects?tag=`  | Without bodies                              |
| `GET /api/projects/:slug` |                                             |
| `POST /api/ask`           | `{ question }`, 5 per client, refills 5/min |
| `GET /api/ask/quota`      | The caller's remaining questions, without spending one |
| `GET /api/skills`         | Skill groups with where each one shows up (`content/skills.md`) |
| `GET /api/contact`        | Whether the contact form is on |
| `POST /api/contact`       | `{ reason, name, email, message }`, 3 per visitor per hour, 30 a day in total |
| `GET /api/status`         | Uptime, memory, pod/node, p50/p95 per route |
| `GET /api/status/history` | In-process samples every 5 min for the last 24h (reset on restart) |
| `GET /metrics`            | Prometheus text format                      |
| `GET /healthz`            | Probes                                      |

## Logs

Every line on stdout is one JSON object with `time`, `level` and `msg`. Each finished
request logs `requestId`, `route` (the matched route, e.g. `GET /api/projects/:slug`),
`status` and `ms`; `/healthz` probes are skipped. Responses carry an `x-request-id`
header: a safe incoming one (from the ingress) is reused, otherwise a UUID is generated.

## Deploy (k3s)

Every push to `develop` builds the image and publishes it to
`ghcr.io/guilherme-b-damasio/portfolio:<YYYYMMDDHHmmss>-<sha>` (`.github/workflows/image.yml`);
pull requests only build it. In the cluster, Flux image automation picks the newest tag by
its timestamp and rolls the deployment, so there is no manual `kubectl apply`.

`k8s/deployment.yaml` is a generic reference (namespace, deployment, service, ingress). The
real manifests, host and TLS issuer live in the private infra repository. Without the
optional `portfolio-secrets` secret the app runs retrieval-only.
