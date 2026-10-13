import { api } from "../api.js";
import { el } from "../dom.js";
import { formatMs, validateContact } from "../lib.js";

const REASONS = [
  ["vaga", "Vaga", "Empresa, vaga e o que chamou sua atenção aqui."],
  ["projeto", "Projeto", "O que você quer construir e qual o prazo."],
  ["conversa", "Só conversar", "Sobre o que você quer falar?"],
];

/** /contato: the form (only when the server has a mailer) and the direct channels from the profile. */
export function createContatoPage({ root }) {
  const $ = (sel) => root.querySelector(sel);
  const form = $("#contact-form");
  const fields = { name: $("#c-name"), email: $("#c-email"), message: $("#c-msg") };
  let reason = "vaga";
  let wired = false;
  let loaded = null;

  function renderReasons() {
    $("#c-reasons").replaceChildren(
      ...REASONS.map(([id, label]) =>
        el(
          "button",
          {
            type: "button",
            class: "toggle-chip",
            attrs: { role: "radio", "aria-checked": String(id === reason) },
            on: {
              click: () => {
                reason = id;
                renderReasons();
              },
            },
          },
          label,
        ),
      ),
    );
    fields.message.placeholder = REASONS.find(([id]) => id === reason)[2];
  }

  function showErrors(errors) {
    for (const [key, input] of Object.entries(fields)) {
      const box = root.querySelector(`[data-error="${key}"]`);
      box.textContent = errors[key] ?? "";
      box.hidden = !errors[key];
      input.setAttribute("aria-invalid", String(Boolean(errors[key])));
    }
    const first = Object.keys(fields).find((k) => errors[k]);
    if (first) fields[first].focus();
  }

  async function send(e) {
    e.preventDefault();
    const values = { name: fields.name.value, email: fields.email.value, message: fields.message.value };
    const errors = validateContact(values);
    showErrors(errors);
    if (Object.keys(errors).length) return;

    const button = $("#c-send");
    button.disabled = true;
    button.firstChild.textContent = "Enviando…";
    $("#c-status").textContent = "";
    try {
      const { res, body, ms } = await api("/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason, ...values, website: $("#c-website").value }),
      });
      if (res.status !== 202) {
        $("#c-status").textContent =
          res.status === 429
            ? `Limite de mensagens desta hora atingido. Tente em ${res.headers.get("retry-after") ?? "alguns"}s, ou use o e-mail ao lado.`
            : (body?.error ?? `Algo deu errado (${res.status}).`);
        return;
      }
      $("#c-receipt").textContent = [
        "$ POST /api/contact",
        `HTTP 202 Accepted · ${formatMs(ms)}`,
        `id       ${body.id}`,
        `assunto  ${reason}`,
        `de       ${values.email.trim()}`,
        `limite   ${res.headers.get("x-ratelimit-remaining")} restantes nesta hora`,
      ].join("\n");
      $("#c-thanks").textContent = `Mensagem enviada. Obrigado, ${values.name.trim().split(/\s+/)[0]}.`;
      form.hidden = true;
      $("#c-sent").hidden = false;
      $("#c-sent").focus();
    } catch {
      $("#c-status").textContent = "A mensagem não chegou ao servidor. Tente de novo ou use o e-mail ao lado.";
    } finally {
      button.disabled = false;
      button.firstChild.textContent = "Enviar mensagem";
    }
  }

  async function copy(text, button) {
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = "copiado ✓";
    } catch {
      button.textContent = "selecione e copie";
    }
    setTimeout(() => (button.textContent = "copiar"), 1600);
  }

  function renderChannels(links) {
    const phoneDigits = links.phone?.replace(/[^\d+]/g, "");
    const channels = [
      links.email && { label: "E-mail", text: links.email, href: `mailto:${links.email}`, copy: links.email },
      links.phone && { label: "Telefone / WhatsApp", text: links.phone, href: `tel:${phoneDigits}`, copy: links.phone },
      links.github && { label: "GitHub", text: links.github.replace(/^https?:\/\//, ""), href: links.github },
      links.linkedin && {
        label: "LinkedIn",
        text: links.linkedin.replace(/^https?:\/\/(www\.)?/, ""),
        href: links.linkedin,
      },
    ].filter(Boolean);
    $("#c-channels").replaceChildren(
      ...channels.map((ch) => {
        const row = el(
          "div",
          { class: "channel-row" },
          el("a", { href: ch.href, target: ch.href.startsWith("http") ? "_blank" : "_self", rel: "noopener" }, ch.text),
        );
        if (ch.copy) {
          const button = el("button", { type: "button", class: "copy-btn" }, "copiar");
          button.addEventListener("click", () => copy(ch.copy, button));
          row.append(button);
        }
        return el("div", { class: "channel" }, el("span", { class: "muted small" }, ch.label), row);
      }),
    );
  }

  async function load() {
    const [{ body: status }, { body: profile }] = await Promise.all([
      api("/api/contact", { auto: true }),
      api("/api/profile", { auto: true }),
    ]);
    renderChannels(profile.links ?? {});
    $("#c-limit").textContent = `POST /api/contact · ${status.perHour} por hora`;
    form.hidden = !status.enabled;
    $("#c-off").hidden = status.enabled;
  }

  return {
    root,
    enter() {
      if (!wired) {
        wired = true;
        renderReasons();
        form.addEventListener("submit", send);
        fields.message.addEventListener(
          "input",
          () => ($("#c-count").textContent = `${fields.message.value.length}/1000`),
        );
        $("#c-again").addEventListener("click", () => {
          fields.message.value = "";
          $("#c-count").textContent = "0/1000";
          $("#c-sent").hidden = true;
          form.hidden = false;
          fields.message.focus();
        });
      }
      loaded ??= load().catch(() => {
        loaded = null; // retry on the next visit
      });
    },
  };
}
