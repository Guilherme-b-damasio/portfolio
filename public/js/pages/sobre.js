import { api } from "../api.js";
import { el, renderBlocks } from "../dom.js";
import { markdownBlocks, sections } from "../lib.js";

/** /sobre: bio, quick facts, skills with evidence, experience and how I work, all from the API. */
export function createSobrePage({ root, act }) {
  const $ = (sel) => root.querySelector(sel);
  let loaded = null;
  let groups = [];
  let selected = null;

  async function load() {
    const [{ body: profile }, { body: skills }] = await Promise.all([
      api("/api/profile", { auto: true }),
      api("/api/skills", { auto: true }),
    ]);
    const byTitle = Object.fromEntries(sections(profile.body));

    $("#sobre-bio").replaceChildren(...renderBlocks(markdownBlocks(byTitle["Sobre"] ?? "")));
    const github = profile.links?.github?.replace(/^https?:\/\//, "");
    const facts = [
      ["nome", profile.fullName ?? profile.name],
      ["cargo", profile.title],
      ["foco", profile.role],
      ["local", profile.location],
      ["código", github],
    ].filter(([, v]) => v);
    $("#sobre-facts").replaceChildren(
      ...facts.map(([k, v]) => el("div", { class: "fact-row" }, el("dt", {}, k), el("dd", {}, v))),
    );

    $("#sobre-exp").replaceChildren(
      ...renderBlocks(markdownBlocks(byTitle["Experiência"] ?? ""), { headingTag: "h3" }),
    );
    $("#sobre-edu").replaceChildren(...renderBlocks(markdownBlocks(byTitle["Formação"] ?? "")));
    $("#sobre-work").replaceChildren(...renderBlocks(markdownBlocks(byTitle["Como eu trabalho"] ?? "")));

    groups = skills;
    selected = selected ?? groups[0]?.items[0]?.name ?? null;
    renderSkills();
  }

  function renderSkills() {
    $("#sobre-skills").replaceChildren(
      ...groups.map((g) =>
        el(
          "div",
          { class: "cell skill-group", attrs: { role: "group", "aria-label": g.title } },
          el("h3", {}, g.title),
          el(
            "div",
            { class: "chip-row" },
            g.items.map((k) =>
              el(
                "button",
                {
                  type: "button",
                  class: "toggle-chip",
                  attrs: { "aria-pressed": String(k.name === selected) },
                  on: {
                    click: () => {
                      selected = k.name;
                      renderSkills();
                    },
                  },
                },
                k.name,
                el("span", { class: "chip-count" }, String(k.evidence.length)),
              ),
            ),
          ),
        ),
      ),
    );

    const skill = groups.flatMap((g) => g.items).find((k) => k.name === selected);
    if (!skill) return;
    const question = `ask "o que você fez com ${skill.name}?"`;
    $("#skill-title").replaceChildren(skill.name, el("span", { class: "muted" }, " · onde aparece"));
    $("#skill-ask").replaceChildren(el("span", { class: "accent", attrs: { "aria-hidden": "true" } }, "$"), question);
    $("#skill-ask").onclick = () => act({ type: "run", target: question });
    $("#skill-evidence").replaceChildren(
      ...skill.evidence.map((ev) =>
        el(
          "li",
          { class: "evidence" },
          el("span", { class: "evidence-where" }, ev.where),
          el("span", {}, ev.text),
          el(
            "button",
            { type: "button", class: "btn btn-line btn-mono", on: { click: () => act(ev.action) } },
            `${ev.action.label} →`,
          ),
        ),
      ),
    );
  }

  return {
    root,
    enter() {
      loaded ??= load().catch(() => {
        loaded = null; // let the next visit retry
      });
    },
  };
}
