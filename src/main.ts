import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Server } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AskQuestion } from "./application/ask-question.js";
import { BrowsePortfolio } from "./application/browse-portfolio.js";
import { BrowseTlsSamples } from "./application/browse-tls-samples.js";
import { InspectCluster } from "./application/inspect-cluster.js";
import { InspectVisitor } from "./application/inspect-visitor.js";
import { LoadLab } from "./application/load-lab.js";
import { scanChecks } from "./application/scan/checks/index.js";
import { ReportStatus } from "./application/report-status.js";
import { SendContact } from "./application/send-contact.js";
import { ShowEvals } from "./application/show-evals.js";
import { ShowTrace } from "./application/show-trace.js";
import { TraceDeploys } from "./application/trace-deploys.js";
import { ProbeNat } from "./application/probe-nat.js";
import { TestDnsLeak } from "./application/test-dns-leak.js";
import { TuneSearch } from "./application/tune-search.js";
import { createApp } from "./http/app.js";
import { MAX_TURNS } from "./http/routes/api.js";
import { CachedClusterReader } from "./infrastructure/cluster/cached-cluster-reader.js";
import { CachedRolloutHistory } from "./infrastructure/cluster/cached-rollout-history.js";
import { CachedTagSelectionHistory } from "./infrastructure/cluster/cached-tag-selection-history.js";
import { FluxTagSelectionHistory } from "./infrastructure/cluster/flux-tag-selection-history.js";
import { inClusterGet } from "./infrastructure/cluster/in-cluster-get.js";
import { KubernetesClusterReader } from "./infrastructure/cluster/kubernetes-cluster-reader.js";
import { KubernetesRolloutHistory } from "./infrastructure/cluster/kubernetes-rollout-history.js";
import { CachedBuildHistory } from "./infrastructure/delivery/cached-build-history.js";
import { GitHubBuildHistory, gitHubGet } from "./infrastructure/delivery/github-build-history.js";
import { MarkdownContentSource } from "./infrastructure/content/markdown-content-source.js";
import { AuthoritativeDnsServer } from "./infrastructure/dns/authoritative-dns-server.js";
import { InMemoryLeakProbes } from "./infrastructure/dns/in-memory-leak-probes.js";
import { LeakZone } from "./infrastructure/dns/leak-zone.js";
import { loadEvalSet } from "./infrastructure/evals/json-eval-set.js";
import { LoopbackTarget } from "./infrastructure/load/loopback-target.js";
import { JsonLogger } from "./infrastructure/logging/json-logger.js";
import { InMemoryCrowd } from "./infrastructure/anonymity/in-memory-crowd.js";
import { AnthropicPriceList } from "./infrastructure/llm/anthropic-price-list.js";
import { ClaudeAnswerer } from "./infrastructure/llm/claude-answerer.js";
import { DailyTokenBudget } from "./infrastructure/llm/daily-token-budget.js";
import { ResendMailer } from "./infrastructure/mail/resend-mailer.js";
import { InMemoryMetrics } from "./infrastructure/metrics/in-memory-metrics.js";
import { AlpnServer } from "./infrastructure/http2/alpn-server.js";
import { Http1Bridge } from "./infrastructure/http2/http1-bridge.js";
import { TrackedHttp2Connections } from "./infrastructure/http2/tracked-http2-connections.js";
import { DnsReverseLookup } from "./infrastructure/net/dns-reverse-lookup.js";
import { FeedIpIntel } from "./infrastructure/net/feed-ip-intel.js";
import { httpText } from "./infrastructure/net/http-text.js";
import {
  AwsRangesFeed,
  AzureServiceTagsFeed,
  GcpRangesFeed,
  TorExitFeed,
} from "./infrastructure/net/ip-range-feeds.js";
import { InMemoryNatBindings } from "./infrastructure/stun/in-memory-bindings.js";
import { StunServer } from "./infrastructure/stun/stun-server.js";
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
// Who owns the visitor's IP, from lists their publishers keep: the Tor exits and the blocks AWS,
// Google Cloud and Azure announce. Downloaded at most once every IP_INTEL_REFRESH_HOURS and matched
// in memory, so a scan never waits on them; IP_INTEL=off drops the whole layer. Azure's file is
// published under a URL with the week's date in it, so that feed waits for AZURE_SERVICE_TAGS_URL.
// "1 em N visitantes tem sua GPU": counters per attribute, in this process and nowhere else.
const crowd = new InMemoryCrowd();
const azureTags = process.env.AZURE_SERVICE_TAGS_URL;
const ipIntel =
  process.env.IP_INTEL === "off"
    ? null
    : new FeedIpIntel(
        [
          new TorExitFeed(httpText(2_000_000)),
          new AwsRangesFeed(httpText(8_000_000)),
          new GcpRangesFeed(httpText(2_000_000)),
          ...(azureTags ? [new AzureServiceTagsFeed(httpText(24_000_000), azureTags)] : []),
        ],
        { refreshMs: Number(process.env.IP_INTEL_REFRESH_HOURS ?? 12) * 3_600_000, logger },
      );
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
// `deploys`: the image builds come from this public repository's Actions runs (no token), the
// rollouts from the deployment's ReplicaSets in the pod's own namespace. DEPLOYS_REPO=off skips GitHub.
const deploysRepo = process.env.DEPLOYS_REPO ?? "Guilherme-b-damasio/portfolio";
const deployment = process.env.DEPLOYS_DEPLOYMENT ?? "portfolio";
const buildHistory =
  deploysRepo === "off" ? null : new CachedBuildHistory(new GitHubBuildHistory(gitHubGet(), { repo: deploysRepo }));
const rolloutHistory = kubeGet
  ? new CachedRolloutHistory(
      new KubernetesRolloutHistory(kubeGet, {
        namespace: process.env.POD_NAMESPACE ?? clusterNamespaces[0] ?? "portfolio",
        deployment,
        selector: `app=${deployment}`,
        container: "web",
      }),
    )
  : null;
// When Flux picked each tag, from its ImagePolicy's events (Role in flux-system, k8s/rbac.yaml).
// DEPLOYS_IMAGE_POLICY=off skips it, e.g. on a cluster without Flux image automation.
const imagePolicy = process.env.DEPLOYS_IMAGE_POLICY ?? deployment;
const tagSelections =
  kubeGet && imagePolicy !== "off"
    ? new CachedTagSelectionHistory(
        new FluxTagSelectionHistory(kubeGet, {
          namespace: process.env.DEPLOYS_FLUX_NAMESPACE ?? "flux-system",
          policy: imagePolicy,
        }),
      )
    : null;
// The DNS leak test needs a zone delegated to this pod (an NS record in the parent zone) and UDP
// reaching DNS_PORT; without DNS_LEAK_ZONE it stays off and /api/dns-leak says so.
const dnsLeakZone = process.env.DNS_LEAK_ZONE?.replace(/\.$/, "").toLowerCase() || null;
const leakProbes = dnsLeakZone ? new InMemoryLeakProbes(dnsLeakZone) : null;
const dnsServer =
  dnsLeakZone && leakProbes
    ? new AuthoritativeDnsServer(
        new LeakZone(leakProbes, {
          zone: dnsLeakZone,
          nameserver: process.env.DNS_LEAK_NS ?? `ns.${dnsLeakZone}`,
          nameserverAddress: process.env.DNS_LEAK_NS_ADDRESS ?? null,
          answerV4: process.env.DNS_LEAK_ANSWER_A ?? null,
          answerV6: process.env.DNS_LEAK_ANSWER_AAAA ?? null,
        }),
        { maxQueriesPerSecond: Number(process.env.DNS_MAX_QPS ?? 200) },
      )
    : null;
// The STUN test needs UDP reaching these ports from outside; without STUN_PORTS it stays off and
// /api/stun says so. Two sockets, because the pair is what shows how the visitor's NAT maps a port:
// the same one for both destinations, or a new one each time.
const stunPorts = ports(process.env.STUN_PORTS);
// What the browser is told to aim at: the Service may publish other ports than the ones bound here,
// and another hostname than this page's. Without a host the page uses its own.
const stunPublicPorts = ports(process.env.STUN_PUBLIC_PORTS).length ? ports(process.env.STUN_PUBLIC_PORTS) : stunPorts;
const stunHost = process.env.STUN_PUBLIC_HOST || null;
const natBindings = stunPorts.length ? new InMemoryNatBindings() : null;
const stunServers = natBindings
  ? stunPorts.map(() => new StunServer(natBindings, { maxRequestsPerSecond: Number(process.env.STUN_MAX_RPS ?? 200) }))
  : [];

function ports(list: string | undefined): number[] {
  return (list ?? "")
    .split(",")
    .map((p) => Number(p.trim()))
    .filter((p) => Number.isInteger(p) && p > 0 && p < 65_536);
}

const tap = certFile && keyFile ? new TlsTap({ proxyProtocol: process.env.TLS_PROXY_PROTOCOL === "1" }) : null;
// What each h2 connection opened with, filled by the TLS front below and read by the scan.
const http2Connections = tap ? new TrackedHttp2Connections() : null;

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
  inspectVisitor: new InspectVisitor(scanChecks(), new DnsReverseLookup(), ipIntel, crowd),
  tapped: tap,
  http2: http2Connections,
  tlsSamples: new BrowseTlsSamples(await FileTlsSamples.load(path.join(root, "data", "tls-samples"))),
  metrics,
  logger,
  traces,
  showTrace: new ShowTrace(traces),
  inspectCluster: new InspectCluster(clusterReader),
  traceDeploys: new TraceDeploys(buildHistory, rolloutHistory, tagSelections),
  // The search playground ranks the same index the chat answers from.
  tuneSearch: new TuneSearch(retriever),
  // The load lab fires at fixed, unlimited routes of this same process over loopback.
  loadLab: new LoadLab(
    [
      ["healthz", "/healthz"],
      ["projects", "/api/projects"],
      ["status", "/api/status"],
    ].map(([name, path]) => new LoopbackTarget(name, path, `http://127.0.0.1:${port}`)),
  ),
  testDnsLeak: leakProbes ? new TestDnsLeak(leakProbes, new DnsReverseLookup()) : null,
  probeNat: natBindings
    ? new ProbeNat(
        natBindings,
        stunPublicPorts.map((port) => ({ host: stunHost, port })),
      )
    : null,
  dnsLeakZone,
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
    ipIntel: ipIntel ? `tor,aws,gcp${azureTags ? ",azure" : ""}` : "off",
  });
});

let tlsServer: Server | null = null;
if (tap && http2Connections && certFile && keyFile) {
  const tlsPort = Number(process.env.TLS_PORT ?? 8443);
  const credentials = () => ({ cert: readFileSync(certFile), key: readFileSync(keyFile) });
  // h2 and http/1.1 on the same port; h2 streams reach Express through an in-process HTTP/1.1 bridge.
  const front = new AlpnServer(new Http1Bridge(app), credentials(), http2Connections);
  tlsServer = tap.server(front.server).listen(tlsPort, () => {
    logger.info("listening", { port: tlsPort, tls: "fingerprinted", alpn: "h2,http/1.1" });
  });
  // cert-manager renews the mounted secret in place; pick the new files up without a restart.
  setInterval(() => {
    try {
      front.server.setSecureContext(credentials());
    } catch (err) {
      logger.error("could not reload the TLS certificate", { error: (err as Error).message });
    }
  }, 6 * 3_600_000).unref();
}

if (natBindings) {
  // Unprivileged ports in the pod; the Service maps the published ones onto them.
  const bound = [];
  for (const [i, server] of stunServers.entries()) bound.push(await server.listen(stunPorts[i]));
  // Each socket points at the next one as OTHER-ADDRESS, so a client can walk the pair itself.
  const stunAddress = process.env.STUN_PUBLIC_ADDRESS || null;
  if (stunAddress)
    stunServers.forEach((server, i) => {
      server.advertise = { address: stunAddress, port: stunPublicPorts[i] };
      server.other = { address: stunAddress, port: stunPublicPorts[(i + 1) % stunPublicPorts.length] };
    });
  logger.info("listening", { stun: bound.join(","), advertised: stunPublicPorts.join(",") });
}

if (dnsServer && dnsLeakZone) {
  // Unprivileged port in the pod; the Service maps 53/udp onto it.
  const dnsPort = await dnsServer.listen(Number(process.env.DNS_PORT ?? 8053));
  logger.info("listening", { port: dnsPort, dns: dnsLeakZone });
}

// k8s sends SIGTERM on rollout; finish in-flight requests before exiting.
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    stopSampling();
    tlsServer?.close();
    void dnsServer?.close();
    for (const server of stunServers) void server.close();
    server.close(() => process.exit(0));
  });
}
