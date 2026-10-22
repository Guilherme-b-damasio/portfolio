import { api } from "../api.js";
import { runDnsLeak } from "../dns-leak.js";
import { copyText, el } from "../dom.js";
import { createHexDump } from "../hexdump.js";
import { resolverParts, scanHeadline, VERDICTS } from "../lib.js";
import { collectProbe } from "../probe.js";

const LAYERS = [
  ["rede", "Rede", "O que chega antes de qualquer código: o IP e o nome dele."],
  [
    "http",
    "HTTP",
    "Os cabeçalhos que o navegador manda em toda requisição e, no HTTP/2, os primeiros frames da conexão.",
  ],
  ["tls", "TLS", "O aperto de mão criptográfico, que denuncia a biblioteca de verdade."],
  ["navegador", "Navegador", "O que qualquer script lê sem pedir permissão."],
];

const BROWSERS = {
  chrome: "Chrome",
  edge: "Edge",
  firefox: "Firefox",
  safari: "Safari",
  opera: "Opera",
  samsung: "Samsung Internet",
  bot: "robô",
  outro: "algo desconhecido",
};
const SYSTEMS = {
  windows: "Windows",
  macos: "macOS",
  ios: "iOS",
  android: "Android",
  linux: "Linux",
  chromeos: "ChromeOS",
  outro: "um sistema desconhecido",
};

/** /voce: scans the visitor's own connection and shows where its layers disagree. */
export function createVocePage({ root }) {
  const $ = (sel) => root.querySelector(sel);
  let scanned = false;
  let running = false;
  let samples = null; // real handshakes from known clients, loaded once
  let own = null; // the visitor's own handshake, when the connection reached our TLS listener
  let shown = null;
  const hexDump = createHexDump($("#handshake"));

  async function scan() {
    if (running) return;
    running = true;
    $("#scan-run").disabled = true;
    $("#scan-summary").setAttribute("aria-busy", "true");
    $("#scan-summary").replaceChildren(el("p", { class: "muted" }, "escaneando…"));
    try {
      const withProbe = !$("#scan-nojs").checked;
      const probe = withProbe ? await collectProbe() : null;
      const { res, body } = await api(
        "/api/scan",
        probe
          ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(probe) }
          : undefined,
      );
      if (!res.ok) {
        $("#scan-summary").replaceChildren(el("p", {}, body?.error ?? `O scan falhou (HTTP ${res.status}).`));
        return;
      }
      render(body);
      own = body.tls;
      if (own) shown = "seu"; // a fresh handshake of their own beats any sample
      await renderHandshakes();
    } catch {
      $("#scan-summary").replaceChildren(el("p", {}, "Não consegui falar com o servidor."));
    } finally {
      running = false;
      $("#scan-run").disabled = false;
      $("#scan-summary").setAttribute("aria-busy", "false");
    }
  }

  function render(report) {
    const { claimed, summary } = report;
    const identity = claimed.tool
      ? `${claimed.tool}, sem navegador`
      : `${BROWSERS[claimed.browser]}${claimed.version ? " " + claimed.version : ""} no ${SYSTEMS[claimed.os]}${claimed.mobile ? ", celular" : ""}`;
    const count = (verdict) => report.findings.filter((f) => f.verdict === verdict).length;
    $("#scan-summary").replaceChildren(
      el("p", { class: "scan-claim" }, el("span", { class: "muted" }, "Seu User-Agent diz: "), identity),
      el("p", { class: "scan-headline" }, scanHeadline(report)),
      el(
        "ul",
        { class: "scan-counts", attrs: { "aria-label": "Contagem por veredito" } },
        Object.entries(VERDICTS).map(([verdict, label]) =>
          el(
            "li",
            { class: "verdict-count", attrs: { "data-verdict": verdict } },
            el("strong", {}, String(count(verdict))),
            label,
          ),
        ),
      ),
      el(
        "p",
        { class: "muted small" },
        `${summary.checks} regras · ${summary.probe ? "com a sonda do navegador" : "só o que o servidor viu"} · ${new Date(report.scannedAt).toLocaleTimeString("pt-BR")}`,
      ),
    );

    $("#scan-findings").replaceChildren(...report.findings.map(findingItem));
    $("#scan-layers").replaceChildren(
      ...LAYERS.map(([id, title, blurb]) => {
        const signals = report.signals.filter((s) => s.layer === id);
        return el(
          "section",
          { class: "cell layer", attrs: { "aria-label": title } },
          el("h3", {}, title),
          el("p", { class: "muted small" }, blurb),
          signals.length
            ? el(
                "dl",
                { class: "signal-list" },
                signals.map((s) => el("div", { class: "fact-row" }, el("dt", {}, s.label), el("dd", {}, s.value))),
              )
            : el("p", { class: "small" }, emptyLayer(id, summary.probe)),
        );
      }),
    );
  }

  async function renderHandshakes() {
    samples ??= await api("/api/scan/tls-samples", { auto: true })
      .then(({ body }) => body)
      .catch(() => []);
    const options = [
      ...(own
        ? [{ ...own, id: "seu", label: "o seu", client: "o handshake que o seu navegador acabou de mandar" }]
        : []),
      ...samples,
    ];
    if (!options.length) return;
    if (!options.some((o) => o.id === shown)) shown = options[0].id;
    $("#handshake-tabs").replaceChildren(
      ...options.map((o) =>
        el(
          "button",
          {
            type: "button",
            role: "tab",
            attrs: { "aria-selected": String(o.id === shown) },
            on: {
              click: () => {
                shown = o.id;
                renderHandshakes();
              },
            },
          },
          o.label,
        ),
      ),
    );
    const current = options.find((o) => o.id === shown);
    $("#handshake-client").textContent = own
      ? `Capturado de: ${current.client}.`
      : `${location.protocol === "https:" ? "Aqui o TLS termina no proxy, então o seu handshake não chega até o código." : "Esta página veio sem HTTPS, então não houve handshake."} Estes são handshakes reais, capturados de: ${current.client}.`;
    hexDump.show(current);
  }

  function findingItem(f) {
    return el(
      "li",
      { class: "finding", attrs: { "data-verdict": f.verdict } },
      el(
        "div",
        { class: "finding-head" },
        el("span", { class: "verdict" }, VERDICTS[f.verdict] ?? f.verdict),
        el("span", { class: "mono muted small" }, f.layer),
      ),
      el("h3", {}, f.title),
      el("p", {}, f.detail),
      f.evidence.length ? el("pre", { class: "finding-evidence" }, f.evidence.join("\n")) : null,
      f.fix ? el("p", { class: "finding-fix small" }, el("strong", {}, "Como resolver: "), f.fix) : null,
    );
  }

  function emptyLayer(id, probe) {
    if (id === "tls") {
      return "O TLS desta conexão termina no proxy, então o seu handshake chega reescrito. Abaixo, handshakes reais de outros clientes, byte a byte.";
    }
    if (id === "navegador" && !probe) return "Sonda desligada: só o que o servidor vê.";
    return "Nada nesta camada.";
  }

  async function testDns() {
    const button = $("#dns-run");
    if (button.disabled) return;
    button.disabled = true;
    $("#dns-result").setAttribute("aria-busy", "true");
    $("#dns-result").replaceChildren(el("p", { class: "muted" }, "pedindo um nome novo…"));
    try {
      const result = await runDnsLeak({
        onProbe: (hostname) => {
          $("#dns-name").textContent = hostname;
          $("#dns-result").replaceChildren(
            el("p", { class: "muted" }, "resolvendo e esperando o resolvedor perguntar…"),
          );
        },
      });
      if (result.off) {
        $("#dns-result").replaceChildren(
          el("p", {}, "O teste está desligado neste servidor: o subdomínio ainda não foi delegado a ele."),
        );
      } else if (result.error) {
        $("#dns-result").replaceChildren(el("p", {}, result.error));
      } else {
        renderDns(result.report);
      }
    } catch {
      $("#dns-result").replaceChildren(el("p", {}, "Não consegui falar com o servidor."));
    } finally {
      button.disabled = false;
      button.textContent = "testar de novo";
      $("#dns-result").setAttribute("aria-busy", "false");
    }
  }

  function renderDns(report) {
    $("#dns-result").replaceChildren(
      el(
        "div",
        { class: "finding", attrs: { "data-verdict": report.verdict } },
        el(
          "div",
          { class: "finding-head" },
          el("span", { class: "verdict" }, VERDICTS[report.verdict] ?? report.verdict),
          el("span", { class: "mono muted small" }, "dns"),
        ),
        el("h3", {}, report.headline),
        el("p", {}, report.detail),
      ),
      // The page's own address is always there, so the resolvers have something to be compared with.
      el(
        "dl",
        { class: "signal-list" },
        el(
          "div",
          { class: "fact-row" },
          el("dt", {}, "você (HTTP)"),
          el("dd", {}, [report.you.ip, report.you.reverseDns].filter(Boolean).join(" · ")),
        ),
        report.resolvers.map((r) => {
          const p = resolverParts(r);
          return el(
            "div",
            { class: "fact-row" },
            el("dt", {}, `resolvedor ${p.relation}`),
            el("dd", {}, `${p.who} · ${p.qtypes}${p.subnet ? " · " + p.subnet : ""}`),
          );
        }),
      ),
    );
  }

  $("#dns-run").addEventListener("click", testDns);
  $("#scan-run").addEventListener("click", scan);
  $("#scan-nojs").addEventListener("change", scan);
  $("#scan-curl").textContent = `curl -s ${location.origin}/api/scan | jq '.findings[] | {verdict, title}'`;
  $("#scan-copy").addEventListener("click", (e) => copyText($("#scan-curl").textContent, e.currentTarget));

  return {
    root,
    enter() {
      if (scanned) return;
      scanned = true;
      scan();
    },
  };
}
