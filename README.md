# portfolio

Personal site where the site itself is the showcase: a Node/TypeScript API with a
BM25 + Claude RAG that answers questions about me, a terminal UI that talks to that
API, and live metrics (`/api/status`, Prometheus at `/metrics`). Runs on k3s.

```bash
npm install
npm run dev          # http://localhost:3000
npm test
npm run e2e          # Playwright smoke against the real server (E2E_CHANNEL=chrome reuses an installed Chrome)
```

Content lives in `content/` as Markdown: `profile.md` plus one file per project in
`content/projects/`. Each `## ` heading becomes one searchable chunk; sections that
still start with `TODO` are left out of the index.

| Env var             | Default           | Purpose                                              |
| ------------------- | ----------------- | ---------------------------------------------------- |
| `PORT`              | `3000`            |                                                      |
| `ANTHROPIC_API_KEY` | unset             | Enables generated answers; without it `/api/ask` returns only the retrieved passages |
| `CLAUDE_MODEL`      | `claude-opus-5-5` | Model used by `/api/ask`                             |
| `LLM_DAILY_TOKEN_BUDGET` | `200000`    | LLM tokens (input + output) per UTC day; past it `/api/ask` returns only the passages, with `degraded: "token-budget"`, until 00:00 UTC |
| `TLS_CERT_FILE`, `TLS_KEY_FILE` | unset | Also serve HTTPS on `TLS_PORT` (default `8443`) and fingerprint each visitor's TLS handshake. Re-read every 6 h |
| `TLS_PROXY_PROTOCOL` | unset | `1` when that port sits behind a TCP passthrough that sends the PROXY protocol; the header then becomes mandatory |
| `ASK_MAX_CONCURRENCY` | `4`             | Questions answered at once across every visitor (HTTP and MCP); above it, 503 with `Retry-After` |
| `ASK_TIMEOUT_MS`    | `60000`           | Generation for one question is aborted past this; a visitor who disconnects aborts it too |
| `GIT_SHA`, `BUILT_AT` | `dev`           | Shown in the footer and `/api/status` (set as Docker build args) |
| `RESEND_API_KEY`, `CONTACT_TO` | unset | Turn on the contact form; messages go to `CONTACT_TO` through Resend |
| `CONTACT_FROM`      | `onboarding@resend.dev` | Sender shown in the e-mail (needs a verified domain on Resend to change) |

## What's new in 0.1

- Ports and adapters layout (`domain/`, `application/`, `infrastructure/`, `http/`), with the
  dependency rule checked by a test.
- ESLint + Prettier in CI, JSON logs with `x-request-id`, and security headers with a CSP that
  allows no inline scripts.
- `/api/ask` is bounded three ways: a per-visitor token bucket, a global concurrency cap (503 with
  `Retry-After`) and a daily LLM token budget that falls back to retrieval only.
- Every push to `develop` publishes `ghcr.io/guilherme-b-damasio/portfolio:<timestamp>-<sha>`.
- A Playwright smoke test opens the page at desktop and 375px, runs `help`, `ask` and `status`
  against the real server, and fails on any console error, failed request or sideways scroll.

## API

| Route                     | Notes                                       |
| ------------------------- | ------------------------------------------- |
| `GET /api/profile`        |                                             |
| `GET /api/projects?tag=`  | Without bodies                              |
| `GET /api/projects/:slug` |                                             |
| `POST /api/ask`           | `{ question }`, 5 per client, refills 5/min; 503 + `Retry-After` when `ASK_MAX_CONCURRENCY` are already running |
| `POST /api/ask` + `Accept: text/event-stream` | Same limits, streamed: `passages` (BM25 hits and timing), `text` (each piece of the answer), then `done` (the full JSON result) or `error` |
| `GET /api/ask/quota`      | The caller's remaining questions, without spending one |
| `GET /api/skills`         | Skill groups with where each one shows up (`content/skills.md`) |
| `GET /api/contact`        | Whether the contact form is on |
| `POST /api/contact`       | `{ reason, name, email, message }`, 3 per visitor per hour, 30 a day in total |
| `GET /api/scan`           | What the bare request gives away (try it with curl); never cached |
| `POST /api/scan`          | Same, plus the browser probe from `/voce`: findings where the layers contradict each other. 10 per visitor per minute |
| `GET /api/scan/tls-samples` | Real ClientHellos captured from known clients (`data/tls-samples/`), with JA4 and every byte annotated |
| `GET /api/status`         | Uptime, memory, pod/node, p50/p95 per route, tokens spent today (`llmBudget`) |
| `GET /api/status/history` | In-process samples every 5 min for the last 24h (reset on restart) |
| `GET /metrics`            | Prometheus text format, including `portfolio_llm_tokens_used_today` |
| `GET /healthz`            | Probes                                      |

Try the stream with curl:

```bash
curl -N -H 'content-type: application/json' -H 'accept: text/event-stream'   -d '{"question":"o que é o docsage?"}' http://localhost:3000/api/ask
```

## Visitor scan (`/voce`)

The page and the terminal's `scan` command cross-examine the visitor's own connection: the
IP and its reverse DNS, the HTTP headers and Client Hints, and what any script can read
(GPU, canvas, time zone, platform, WebRTC candidates gathered without a STUN server). Each
rule is an `ExposureCheck` in `src/application/scan/checks/`; it reports `contradicao` when two
layers disagree (a spoofed User-Agent, a half-spoofed time zone, automation), `exposto` when
something could be hidden, `info` or `ok`. The report is computed per request and answered:
no scan, IP or fingerprint is stored or logged, and the reverse DNS lookup has an 800 ms deadline.

### TLS fingerprint (JA4)

Behind a TLS-terminating proxy the app never sees the handshake. With `TLS_CERT_FILE` and
`TLS_KEY_FILE` set it also listens on `TLS_PORT`, where a tap reads each connection's raw
ClientHello before handing the socket to the HTTPS server: the parser in
`src/infrastructure/tls/` computes [JA4](https://github.com/FoxIO-LLC/ja4) (checked against the
spec's worked example), and the scan compares the TLS library that wrote the handshake with the
browser the User-Agent claims. A curl or Python script wearing a Chrome User-Agent shows up as a
contradiction. The raw header order is also reported, since no proxy rewrote it.

In the cluster this needs a TCP passthrough route that sends the PROXY protocol, so the app
still learns the visitor's address: see `k8s/scan-tls-passthrough.example.yaml`. Until then
`/voce` shows real handshakes captured from Chromium, Python, Node.js and curl on Windows.

To try it locally:

```bash
mkdir -p .certs && printf '[req]\ndistinguished_name=dn\n[dn]\n' > .certs/req.cnf
openssl req -x509 -config .certs/req.cnf -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 7 -subj /CN=localhost -keyout .certs/key.pem -out .certs/cert.pem
TLS_CERT_FILE=.certs/cert.pem TLS_KEY_FILE=.certs/key.pem npm run dev
curl -sk -A "Mozilla/5.0 Chrome/152.0.0.0" https://localhost:8443/api/scan | jq '.findings[0].title'
```

## MCP

`/mcp` is a public, read-only MCP server (Streamable HTTP, stateless) with the same data as
the terminal: `list_projects`, `get_project`, `ask` and `get_status`. `ask` spends the same
per-visitor question bucket and the global concurrency cap as `POST /api/ask`, and every call is capped at 60 a minute.

```bash
claude mcp add --transport http portfolio https://<host>/mcp
```

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
