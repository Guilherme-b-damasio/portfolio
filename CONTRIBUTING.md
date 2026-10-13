# Contributing

## Branching (git flow)

| Branch      | Purpose                                                      |
| ----------- | ------------------------------------------------------------ |
| `main`      | Released code only. Every merge is tagged `vX.Y.Z`.          |
| `develop`   | Integration branch and default branch. Features merge here.  |
| `feature/*` | One feature or fix, branched from `develop`.                 |
| `release/*` | Version bump and changelog, merged to `main` and `develop`.  |
| `hotfix/*`  | Urgent fix branched from `main`.                             |

Features are merged with `git merge --no-ff` so the history keeps the feature boundary.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/), in English:

```
feat(ask): stream answers over SSE
fix(search): ignore placeholder sections when indexing
test(http): cover the daily token budget
refactor(metrics): extract the percentile window
docs: document the deploy flow
ci: publish the image to GHCR
```

Keep each commit small and focused. `npm run typecheck`, `npm run lint` and `npm test` must
pass before every commit. `npm run format` fixes formatting; the dependency rule between layers
is enforced by `tests/architecture.test.ts`.

## Architecture

Ports and adapters, with dependencies pointing inward:

```
src/
  domain/          entities and ports (interfaces). Imports nothing from other layers.
  application/     use cases. Depend only on domain ports.
  infrastructure/  adapters implementing ports: BM25, Claude, content loader, metrics, k8s.
  http/            Express app, routers and middleware. Thin: parse, call a use case, respond.
  main.ts          the only composition root: builds adapters and wires them in.
public/            static front-end, no build step.
content/           Markdown the site and the RAG are built from.
```

- New behaviour is a new class implementing a port (open/closed), injected through the
  constructor. Classes stay single-purpose.
- Routes never touch an adapter directly; they call a use case.
- Everything a visitor can trigger is bounded on the server: rate, concurrency, timeout and cost.
- Claude API code uses the official `@anthropic-ai/sdk`, never disables thinking, sets
  `output_config.effort`, and handles `stop_reason === "refusal"`.
- Tests use fakes for every external service. The real Claude API is never called in tests.

## Front-end

Plain HTML, CSS and ES modules in `public/`, no framework and no build step. Never put
API data into `innerHTML`; build nodes with `textContent`. Every page works at 375px wide
and in light and dark mode.
