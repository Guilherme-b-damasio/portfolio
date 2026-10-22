# portfolio

Personal site where the site itself is the showcase: a Node/TypeScript API with a
BM25 + Claude RAG that answers questions about me, a terminal UI that talks to that
API, and live metrics (`/api/status`, Prometheus at `/metrics`). Runs on k3s.

```bash
npm install
npm run dev          # http://localhost:3000
npm test
npm run e2e          # Playwright smoke against the real server (E2E_CHANNEL=chrome reuses an installed Chrome)
npm run eval         # recall@3 of the local index on data/evals/rag.json, question by question
```

### RAG eval

`data/evals/rag.json` holds questions a visitor would ask, each with the sources that should come
back (`docsage.md` accepts any of its sections, `docsage.md › Decisões técnicas` only that one).
`npm run eval` runs them through the real index and prints where the first expected source landed,
recall@3 and MRR; CI runs it and `tests/rag-eval.test.ts` fails the build when recall drops below the
set's `minRecall`. Misses stay in the set on purpose: they are what the next change to the index has to fix.
The `/evals` page (`#/evals`, `GET /api/evals?engine=local|docsage`) runs the same set against the index
the pod is serving; each engine is scored at most once every 10 minutes, whoever asks.

Content lives in `content/` as Markdown: `profile.md` plus one file per project in
`content/projects/`. Each `## ` heading becomes one searchable chunk; sections that
still start with `TODO` are left out of the index. Index and questions go through the same light
Portuguese stemmer (`src/infrastructure/search/portuguese-stemmer.ts`), so "trabalha" finds
"trabalho" and "times" finds "time"; the x-ray shows the stems.

| Env var             | Default           | Purpose                                              |
| ------------------- | ----------------- | ---------------------------------------------------- |
| `PORT`              | `3000`            |                                                      |
| `ANTHROPIC_API_KEY` | unset             | Enables generated answers; without it `/api/ask` returns only the retrieved passages |
| `CLAUDE_MODEL`      | `claude-opus-5-5` | Model used by `/api/ask`                             |
| `LLM_DAILY_TOKEN_BUDGET` | `200000`    | LLM tokens (input + output) per UTC day; past it `/api/ask` returns only the passages, with `degraded: "token-budget"`, until 00:00 UTC |
| `TLS_CERT_FILE`, `TLS_KEY_FILE` | unset | Also serve HTTPS on `TLS_PORT` (default `8443`, h2 and HTTP/1.1) and fingerprint each visitor's TLS handshake and HTTP/2 preface. Re-read every 6 h |
| `DNS_LEAK_ZONE` | unset | Zone delegated to this app for the DNS leak test (e.g. `leak.example.com`); turns on the UDP server on `DNS_PORT` (default `8053`) and `/api/dns-leak` |
| `DNS_LEAK_NS`, `DNS_LEAK_NS_ADDRESS` | `ns.$DNS_LEAK_ZONE`, unset | The nameserver name the parent zone delegates to, and its IPv4 for resolvers that ask |
| `DNS_LEAK_ANSWER_A`, `DNS_LEAK_ANSWER_AAAA` | unset | What probe names resolve to; unset answers NODATA, which is enough for the test |
| `DNS_MAX_QPS` | `200` | Queries answered per second across every resolver; the rest are dropped |
| `TLS_PROXY_PROTOCOL` | unset | `1` when that port sits behind a TCP passthrough that sends the PROXY protocol; the header then becomes mandatory |
| `ASK_RATE_PER_MINUTE` | `5`             | Questions per visitor: a bucket of this size that refills at this rate per minute (HTTP and MCP share it) |
| `ASK_MAX_CONCURRENCY` | `4`             | Questions answered at once across every visitor (HTTP and MCP); above it, 503 with `Retry-After` |
| `ASK_TIMEOUT_MS`    | `60000`           | Generation for one question is aborted past this; a visitor who disconnects aborts it too |
| `DOCSAGE_MCP_URL`  | unset             | docsage's MCP endpoint (Streamable HTTP, e.g. `http://docsage:8765/mcp`). Turns on `ask --engine docsage` |
| `DOCSAGE_TIMEOUT_MS` | `2000`          | One docsage search, connection included; past it the question is answered from the local index |
| `DEPLOYS_REPO`      | `Guilherme-b-damasio/portfolio` | Public repository whose `Image` workflow runs feed `deploys`; `off` skips GitHub |
| `DEPLOYS_DEPLOYMENT` | `portfolio`     | Deployment (and `app=` label) whose ReplicaSets are the revisions in `deploys` |
| `DEPLOYS_IMAGE_POLICY` | `$DEPLOYS_DEPLOYMENT` | Flux `ImagePolicy` whose events say when each tag was picked; `off` skips Flux |
| `DEPLOYS_FLUX_NAMESPACE` | `flux-system` | Namespace of that `ImagePolicy` (needs the events Role in `k8s/rbac.yaml`) |
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

## What's new in 0.2

- Answers stream over SSE, and `ask --xray` shows each step: query terms, the BM25 ranking with
  scores, the exact prompt, time to first token, tokens/s and the estimated cost in US$.
- Follow-up questions with a short memory kept by the browser (`ask --new` starts over), and
  citations you can click to `cat` the section they came from.
- `ask --engine docsage` searches a docsage index over MCP and falls back to the local BM25,
  saying why, when docsage is off, slow or down.
- A retrieval eval of 21 questions gates CI on recall@3, and `/evals` shows it live for the running
  index. A light Portuguese stemmer took it from 0.905 to 0.952 (MRR 0.786 → 0.873).

## What's new in 0.3

- Every API response carries an `x-trace-id`, and `trace <id>` (or a click on a past command)
  draws its spans as a waterfall, from a ring buffer in memory.
- The pod reads its own cluster through a read-only service account: `kubectl get pods|nodes` and
  the Cluster panel show node usage against capacity and every pod in the allowed namespaces.
  `tests/k8s-rbac.test.ts` keeps the RBAC at get/list and in step with the paths the code calls.
- The Live panel keeps 24 h of metrics in a ring buffer and draws them as sparklines.
- `deploys` follows each push from commit to image build (GitHub Actions) to the tag Flux picked to
  the rollout and pod Ready, each source failing on its own.

## API

| Route                     | Notes                                       |
| ------------------------- | ------------------------------------------- |
| `GET /api/profile`        |                                             |
| `GET /api/projects?tag=`  | Without bodies                              |
| `GET /api/projects/:slug` |                                             |
| `POST /api/ask`           | `{ question }`, 5 per client, refills 5/min; 503 + `Retry-After` when `ASK_MAX_CONCURRENCY` are already running |
| `POST /api/ask` + `Accept: text/event-stream` | Same limits, streamed: `passages` (BM25 hits and timing), `text` (each piece of the answer), then `done` (the full JSON result) or `error` |
| `POST /api/ask` with `xray: true` | Same answer plus `xray`: the query terms, the BM25 ranking with the runners-up the LLM did not get, the exact prompt, time to first token, tokens/s and an estimated cost (`src/infrastructure/llm/anthropic-price-list.ts`). `ask --xray` in the terminal |
| `POST /api/ask` with `history` | A follow-up: up to 3 earlier `{ question, answer }` turns (answers ≤ 1500 chars), kept by the browser only. The previous question joins the BM25 query; the turns go to Claude before the newest question. `ask --new` in the terminal starts over |
| `POST /api/ask` with `engine` | `"local"` (default, BM25 in this process) or `"docsage"`, searched through docsage's `search_documents` MCP tool. When docsage is off, slow or down the local index answers and `engineFallback` says why; the reply's `engine` is the one that searched. `ask --engine docsage` in the terminal |
| `GET /api/ask/engines`    | The engines this server can search with      |
| `GET /api/evals?engine=`  | recall@3, MRR and every question of `data/evals/rag.json` against that engine, cached 10 min; an engine that is down comes back as `{ error }` |
| `GET /api/ask/quota`      | The caller's remaining questions, without spending one |
| `GET /api/skills`         | Skill groups with where each one shows up (`content/skills.md`) |
| `GET /api/contact`        | Whether the contact form is on |
| `POST /api/contact`       | `{ reason, name, email, message }`, 3 per visitor per hour, 30 a day in total |
| `GET /api/lab/ratelimit`  | The rate limit lab: spends one token from a bucket of 10 per visitor that refills one every 3 s, apart from the question bucket. 429 + `Retry-After` once it is empty. `ratelimit [n]` in the terminal fires up to 10 and draws the bucket from the headers |
| `GET /api/lab/ratelimit/bucket` | The lab bucket's balance, without spending |
| `GET /api/lab/search?q=&k1=&b=&k=` | The search playground: the chat's own BM25 index ranked with the visitor's `k1` (0–3), `b` (0–1) and top-k (1–10), each hit with its rank under the server's defaults (`defaultRank`) and what every query term added to its score (`tf`, `df`, `idf`). 60 per visitor, refilling 2 a second. `search "<query>"` in the terminal draws sliders that rerank live |
| `GET /api/lab/search/params` | The sliders' ranges and the server's own `k1`, `b` and `k` |
| `POST /api/lab/load`      | The load lab: `{ target, requests ≤ 200, concurrency ≤ 10 }` fired by the server at one of its own routes over loopback (`healthz`, `projects`, `status`), streamed over SSE: `queued` with the position while another run is going, `start`, one `sample` per request (`status`, `ms`), then `done` with p50/p95/p99, max and req/s. One run at a time across every visitor, at most 5 waiting (503 + `Retry-After` past that), 30 s per run, 3 runs per visitor per minute. `load [n] [c]` in the terminal |
| `GET /api/lab/load`       | Whether the load runner is busy, how many are waiting, the limits and the targets |
| `GET /api/scan`           | What the bare request gives away (try it with curl); never cached |
| `POST /api/scan`          | Same, plus the browser probe from `/voce`: findings where the layers contradict each other. 10 per visitor per minute |
| `GET /api/scan/tls-samples` | Real ClientHellos captured from known clients (`data/tls-samples/`), with JA4 and every byte annotated |
| `GET /api/status`         | Uptime, memory, pod/node, p50/p95 per route, tokens spent today (`llmBudget`), and `cluster: { namespaces }` when the pod can read its cluster |
| `GET /api/cluster`        | Nodes (with CPU and memory against capacity) and the pods of every visible namespace, read from the Kubernetes API; 503 with `off: true` outside a cluster, 503 + `Retry-After` when the API server is out of reach |
| `GET /api/cluster/nodes`, `GET /api/cluster/pods?namespace=` | The same, one kind at a time; a namespace outside the whitelist answers 403 with the visible ones |
| `GET /api/deploys`       | The last pushes to `develop`, each from commit to image build (GitHub Actions) to the tag Flux picked (`selectedAt`) to rollout (the ReplicaSet Flux's change created) to pod Ready. Always 200: `sources.github`, `sources.cluster` and `sources.flux` say on their own whether they answered (`ok`, `off` or `unavailable` with a safe `error`) |
| `GET /api/status/history` | In-process samples every 5 min for the last 24h (reset on restart) |
| `GET /api/traces/:id`     | One finished `/api` or `/mcp` request, step by step: route, status, total time and its spans (`retrieve`, `generate`) with offsets, durations and attributes. The id comes in each response's `x-trace-id`; the last 500 are kept in memory, 32 spans each. `trace [id]` in the terminal draws the waterfall |
| `GET /metrics`            | Prometheus text format, including `portfolio_llm_tokens_used_today` |
| `GET /healthz`            | Probes                                      |

Try the stream with curl:

```bash
curl -N -H 'content-type: application/json' -H 'accept: text/event-stream'   -d '{"question":"o que é o docsage?"}' http://localhost:3000/api/ask
```

## Rate limits

Every limited route (`/api/ask`, `/mcp`, `/api/scan`, `/api/contact` and the labs) is an in-memory
token bucket per visitor (`src/http/middleware/rate-limit.ts`) and says where the visitor stands on
every response: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` (seconds until the
bucket is full again) and, on a 429, `Retry-After`. A full bucket is dropped from memory, so idle
visitors cost nothing. `ratelimit` in the terminal fires at a bucket of its own and draws it from
those headers alone; nothing about the limit is computed in the browser.

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

That port offers `h2` as well as `http/1.1`. On an h2 connection the first decrypted bytes (the
client preface up to its first request) are read and fingerprinted in
Akamai's format ("Passive Fingerprinting of HTTP/2 Clients", Black Hat EU 2017):
SETTINGS, the connection's WINDOW_UPDATE, PRIORITY frames and the pseudo-header order, which
differs between Chrome (`m,a,s,p`), Firefox (`m,p,a,s`), Safari and HTTP libraries. Express 5
doesn't run on Node's `http2` API, so each h2 stream is replayed to the app as HTTP/1.1 over an
in-memory pipe that keeps the visitor's address, port and header order
(`src/infrastructure/http2/`). Each connection is capped at 16 concurrent streams.

The scan then checks the preface against the User-Agent, like it does with the ClientHello:
tools that copy a browser's TLS handshake often forget this layer, so curl with a Chrome
User-Agent shows up as `m,p,s,a` where Chrome sends `m,a,s,p` and asks for a 6 MB window.

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

### DNS leak test

The app can be the authoritative server for a small zone (`DNS_LEAK_ZONE`), written on
`node:dgram` in `src/infrastructure/dns/`. `POST /api/dns-leak` hands out a random name under it;
the page makes the browser resolve that name, and the query that reaches the zone comes from
whichever resolver the visitor's system really uses. `GET /api/dns-leak/:token` then says who
asked: the visitor's own network, a known public resolver (Google, Cloudflare, Quad9...) or
another network, which is what a VPN that lets DNS escape looks like. When the resolver forwards
an EDNS Client Subnet that does not contain the address the page came from, the real network
shows through the DNS, and the report calls it a contradiction.

The server only records names it handed out (at most 2 000 at once, for 5 minutes), answers no
more than `DNS_MAX_QPS` queries per second, refuses names outside its zone and never answers
with more than it was asked, so it cannot be used to amplify traffic. To try it locally:

```bash
DNS_LEAK_ZONE=leak.localhost npm run dev
TOKEN=$(curl -s -X POST localhost:3000/api/dns-leak | jq -r .token)
dig @127.0.0.1 -p 8053 +subnet=200.150.1.0/24 $TOKEN.leak.localhost
curl -s localhost:3000/api/dns-leak/$TOKEN | jq '.headline, .resolvers'
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

## Tracing

Every `/api` and `/mcp` request opens a trace (`src/infrastructure/tracing/in-memory-traces.ts`) and
answers with its random id in `x-trace-id`. Use cases time their steps as spans of it: `ask` records
`retrieve` (engine, k, hits, fallback) and `generate` (model, tokens, time to the first token).
Attributes are set by code, never copied from what the visitor sent. Finished traces live in a ring
buffer of 500, so `GET /api/traces/:id` works for a few hundred requests and then answers 404. Each
answer in the terminal ends with a `trace` link, and `trace` alone opens the last request you made.
Once a command finishes, its `$ ...` line turns into a link to the trace of the request it made
(`public/js/api.js` records the `x-trace-id`s while it runs); commands that made several requests
number them beside it, and ones that never reached the API, like `help`, stay plain text.

## Cluster reader

`ClusterReader` (`src/domain/cluster.ts`) is the read-only view of the cluster the site runs on:
nodes, and pods in a whitelist of namespaces, with CPU and memory from metrics-server when it is
installed. `KubernetesClusterReader` calls the API server with plain GETs and the pod's own service
account (`inClusterGet`, which reads the rotated token on every call and caps each answer at 2 MB
and 3 s); there is no client library. Namespaces outside the whitelist are refused before any call,
and error messages never name the API server. `CachedClusterReader` keeps each answer for 5 s and
shares the read in flight, so visitors cannot multiply the load on the API server. Tests run it
against a fake API and a local HTTP server.

`InspectCluster` serves it at `/api/cluster`. In the terminal, `kubectl get pods [-n <ns>|-A]` and
`kubectl get nodes` print it in kubectl's own columns (any other verb is refused, as the service
account would), and the "Cluster" block under "Ao vivo" polls it every 15 s once `/api/status` says
the cluster is on. The namespaces come from `CLUSTER_NAMESPACES` (comma-separated), falling back to
the pod's own `POD_NAMESPACE`; outside a cluster both say so instead of failing.

## Deploys timeline

`deploys` in the terminal follows each push to `develop` on its way to production: commit → image
→ tag picked → Flux rollout → pod Ready, with the wait at each stage. Three read-only sources meet
on the sha in the image tag (`<YYYYMMDDHHmmss>-<sha>`):

- `GitHubBuildHistory` reads the runs of the `Image` workflow on `develop` from the public GitHub
  API, without a token: one call per read, 3 s timeout, 500 KB cap. `CachedBuildHistory` keeps the
  answer for 5 minutes, so the server stays far below GitHub's 60 anonymous calls an hour.
- `KubernetesRolloutHistory` lists the deployment's ReplicaSets (one per revision, as many as
  `revisionHistoryLimit` keeps) and its pods' Ready transitions, with the same service account as
  the cluster reader. `CachedRolloutHistory` keeps it for 10 s.
- `FluxTagSelectionHistory` reads the `ImagePolicy`'s events in `flux-system` (one GET, filtered on
  the server to that policy) and parses the tag out of image-reflector-controller's "Latest image tag
  … resolved to / updated from … to …" message. The API server drops events after `--event-ttl` (an
  hour by default), so older deploys show `?` at that stage and their rollout is timed from the
  build instead. `CachedTagSelectionHistory` keeps it for 10 s.

`TraceDeploys` joins them, and each source can fail on its own: outside a cluster the timeline
still shows the builds, and with GitHub rate-limited it still shows the revisions. `DEPLOYS_REPO`
(`owner/name`, default this repository; `off` to skip GitHub) and `DEPLOYS_DEPLOYMENT` (default
`portfolio`, also used as the `app=` label) point it elsewhere; `DEPLOYS_IMAGE_POLICY=off` skips Flux.

## Deploy (k3s)

Every push to `develop` builds the image and publishes it to
`ghcr.io/guilherme-b-damasio/portfolio:<YYYYMMDDHHmmss>-<sha>` (`.github/workflows/image.yml`);
pull requests only build it. In the cluster, Flux image automation picks the newest tag by
its timestamp and rolls the deployment, so there is no manual `kubectl apply`.

`k8s/deployment.yaml` is a generic reference (namespace, deployment, service, ingress). The
real manifests, host and TLS issuer live in the private infra repository. Without the
optional `portfolio-secrets` secret the app runs retrieval-only.

`k8s/rbac.yaml` gives the pod its read-only view of the cluster: a `portfolio` service account, a
ClusterRole to get and list nodes (and their metrics-server usage), and a Role per visible namespace
to get and list pods (plus the deployment's ReplicaSets in its own namespace, for `deploys`), and a
Role in `flux-system` to get and list events only, for the tag stage of `deploys`. No watch, no secrets, no logs, no exec. Each namespace in `CLUSTER_NAMESPACES`
needs its own Role and RoleBinding; `tests/k8s-rbac.test.ts` fails if a rule ever grants more than
get/list or stops covering a path the reader calls.
