import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import https from "node:https";
import type { Server } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AskQuestion } from "./application/ask-question.js";
import { BrowsePortfolio } from "./application/browse-portfolio.js";
import { BrowseTlsSamples } from "./application/browse-tls-samples.js";
import { InspectCluster } from "./application/inspect-cluster.js";
import { InspectVisitor } from "./application/inspect-visitor.js";
import { scanChecks } from "./application/scan/checks/index.js";
import { ReportStatus } from "./application/report-status.js";
import { SendContact } from "./application/send-contact.js";
import { ShowEvals } from "./application/show-evals.js";
import { ShowTrace } from "./application/show-trace.js";
import { createApp } from "./http/app.js";
import { MAX_TURNS } from "./http/routes/api.js";
import { CachedClusterReader } from "./infrastructure/cluster/cached-cluster-reader.js";
import { inClusterGet } from "./infrastructure/cluster/in-cluster-get.js";
import { KubernetesClusterReader } from "./infrastructure/cluster/kubernetes-cluster-reader.js";
import { MarkdownContentSource } from "./infrastructure/content/markdown-content-source.js";
import { loadEvalSet } from "./infrastructure/evals/json-eval-set.js";
import { JsonLogger } from "./infrastructure/logging/json-logger.js";
import { AnthropicPriceList } from "./infrastructure/llm/anthropic-price-list.js";
import { ClaudeAnswerer } from "./infrastructure/llm/claude-answerer.js";
import { DailyTokenBudget } from "./infrastructure/llm/daily-token-budget.js";
import { ResendMailer } from "./infrastructure/mail/resend-mailer.js";
import { InMemoryMetrics } from "./infrastructure/metrics/in-memory-metrics.js";
import { DnsReverseLookup } from "./infrastructure/net/dns-reverse-lookup.js";
import { FileTlsSamples } from "./infrastructure/tls/file-tls-samples.js";
import { TlsTap } from "./infrastructure/tls/tls-tap.js";
import { SampledHistory } from "./infrastructure/metrics/sampled-history.js";
import { Bm25Retriever } from "./infrastructure/search/bm25-retriever.js";
import { chunkContent } from "./infrastructure/search/chunker.js";
import { DocsageRetriever } from "./infrastructure/search/docsage-retriever.js";
import { InMemoryTraces } from "./infrastructure/tracing/in-memory-traces.js";

// The only composition root: every adapter is built here and injected into the use cases.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT ?? 3000);

const content = await new MarkdownContentSource(process.env.CONTENT_DIR ?? path.join(root, "content")).load();
const retriever = new Bm25Retriever(chunkContent(content));
// docsage's MCP server (Streamable HTTP) as a second engine for `ask --engine docsage`; off when unset.
const docsageUrl = process.env.DOCSAGE_MCP_URL;
const docsage = docsageUrl
  ? new DocsageRetriever(
      async () => {
        const client = new Client({ name: "portfolio", version: "0.1.0" });
        await client.connect(new StreamableHTTPClientTransport(new URL(docsageUrl)));
        return client;
      },
      { timeoutMs: Number(process.env.DOCSAGE_TIMEOUT_MS ?? 2_000) },
    )
  : null;
// Without a key the chat still works: it returns the retrieved passages instead of a generated answer.
const answerer = process.env.ANTHROPIC_API_KEY ? new ClaudeAnswerer() : null;
// Past this many tokens in a UTC day, answers fall back to the retrieved passages until midnight.
const budget = answerer ? new DailyTokenBudget(Number(process.env.LLM_DAILY_TOKEN_BUDGET ?? 200_000)) : null;
// The contact form only turns on when both are set; until then the page shows the direct channels.
const mailer =
  process.env.RESEND_API_KEY && process.env.CONTACT_TO
    ? new ResendMailer(process.env.RESEND_API_KEY, process.env.CONTACT_TO, process.env.CONTACT_FROM)
    : null;
const askRate = Number(process.env.ASK_RATE_PER_MINUTE ?? 5);
const metrics = new InMemoryMetrics();
const history = new SampledHistory(metrics);
const stopSampling = history.start();
const logger = new JsonLogger();
// The last 500 API requests, step by step, for `trace <id>`.
const traces = new InMemoryTraces({ capacity: 500 });
// With a certificate the app also terminates TLS itself, so the scan can read each visitor's ClientHello.
// In the cluster this needs a TCP passthrough route; behind a TLS-terminating proxy there is nothing to read.
const certFile = process.env.TLS_CERT_FILE;
const keyFile = process.env.TLS_KEY_FILE;
// Inside the cluster the pod reads its own nodes and pods with its service account (k8s/rbac.yaml).
// Only these namespaces are listed; outside a cluster `kubectl` and the panel say the cluster is off.
const kubeGet = inClusterGet();
const clusterNamespaces = (process.env.CLUSTER_NAMESPACES ?? process.env.POD_NAMESPACE ?? "portfolio")
  .split(",")
  .map((ns) => ns.trim())
  .filter(Boolean);
const clusterReader = kubeGet
  ? new CachedClusterReader(new KubernetesClusterReader(kubeGet, { namespaces: clusterNamespaces }))
  : null;
const tap = certFile && keyFile ? new TlsTap({ proxyProtocol: process.env.TLS_PROXY_PROTOCOL === "1" }) : null;

const app = createApp({
  browse: new BrowsePortfolio(content),
  askQuestion: new AskQuestion(retriever, answerer, {
    budget,
    prices: new AnthropicPriceList(),
    maxTurns: MAX_TURNS,
    engines: docsage ? { docsage } : {},
  }),
  reportStatus: new ReportStatus(
    metrics,
    answerer?.model ?? null,
    history,
    budget,
    clusterReader ? clusterReader.namespaces : null,
  ),
  sendContact: new SendContact(mailer),
  inspectVisitor: new InspectVisitor(scanChecks(), new DnsReverseLookup()),
  tapped: tap,
  tlsSamples: new BrowseTlsSamples(await FileTlsSamples.load(path.join(root, "data", "tls-samples"))),
  metrics,
  logger,
  traces,
  showTrace: new ShowTrace(traces),
  inspectCluster: new InspectCluster(clusterReader),
  publicDir: path.join(root, "public"),
  // Questions per visitor: a bucket this size that refills at the same rate per minute.
  askLimit: { capacity: askRate, refillPerMinute: askRate },
  askConcurrency: Number(process.env.ASK_MAX_CONCURRENCY ?? 4),
  askTimeoutMs: Number(process.env.ASK_TIMEOUT_MS ?? 60_000),
  // The same questions CI scores, run against the index this pod is actually serving.
  showEvals: new ShowEvals(await loadEvalSet(path.join(root, "data", "evals", "rag.json")), {
    local: retriever,
    ...(docsage && { docsage }),
  }),
});

const server = app.listen(port, () => {
  logger.info("listening", {
    port,
    projects: content.projects.length,
    llm: answerer?.model ?? "off",
    docsage: docsage ? "on" : "off",
    contact: mailer ? "on" : "off",
    cluster: clusterReader ? clusterNamespaces.join(",") : "off",
  });
});

let tlsServer: Server | null = null;
if (tap && certFile && keyFile) {
  const tlsPort = Number(process.env.TLS_PORT ?? 8443);
  const credentials = () => ({ cert: readFileSync(certFile), key: readFileSync(keyFile) });
  const httpsServer = https.createServer(credentials(), app);
  tlsServer = tap.server(httpsServer).listen(tlsPort, () => {
    logger.info("listening", { port: tlsPort, tls: "fingerprinted" });
  });
  // cert-manager renews the mounted secret in place; pick the new files up without a restart.
  setInterval(() => {
    try {
      httpsServer.setSecureContext(credentials());
    } catch (err) {
      logger.error("could not reload the TLS certificate", { error: (err as Error).message });
    }
  }, 6 * 3_600_000).unref();
}

// k8s sends SIGTERM on rollout; finish in-flight requests before exiting.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    stopSampling();
    tlsServer?.close();
    server.close(() => process.exit(0));
  });
}
