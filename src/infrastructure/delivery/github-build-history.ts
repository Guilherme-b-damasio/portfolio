import { z } from "zod";
import { type BuildHistory, type BuildStatus, type BuildView, DeliveryUnavailable } from "../../domain/delivery.js";

/** One GET against the GitHub API, answering the parsed JSON body. Throws GitHubApiError on a non-2xx. */
export type GitHubGet = (url: string, signal: AbortSignal) => Promise<unknown>;

export class GitHubApiError extends Error {
  override name = "GitHubApiError";
  constructor(
    readonly status: number,
    readonly rateLimited: boolean,
    message: string,
  ) {
    super(message);
  }
}

/** Unauthenticated GET with the headers GitHub asks for, refusing answers past `maxBytes`. */
export function gitHubGet(maxBytes = 500_000): GitHubGet {
  return async (url, signal) => {
    const res = await fetch(url, {
      signal,
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "portfolio-deploys",
        "x-github-api-version": "2022-11-28",
      },
    });
    if (!res.ok) {
      const rateLimited =
        (res.status === 403 || res.status === 429) && res.headers.get("x-ratelimit-remaining") === "0";
      throw new GitHubApiError(res.status, rateLimited, `GET ${new URL(url).pathname}: ${res.status}`);
    }
    const text = await res.text();
    if (text.length > maxBytes) throw new Error(`resposta acima de ${maxBytes} bytes`);
    return JSON.parse(text);
  };
}

// Only the fields the timeline needs; everything else in a workflow run is ignored.
const runs = z.object({
  workflow_runs: z.array(
    z.object({
      head_sha: z.string().regex(/^[0-9a-f]{40}$/),
      status: z.string().nullish(),
      conclusion: z.string().nullish(),
      created_at: z.string(),
      run_started_at: z.string().nullish(),
      updated_at: z.string(),
      html_url: z.string(),
      head_commit: z
        .object({
          message: z.string(),
          timestamp: z.string().nullish(),
          author: z.object({ name: z.string() }).partial().nullish(),
        })
        .nullish(),
    }),
  ),
});

// owner/repo as GitHub allows them, and a workflow file name; checked before they reach a URL.
const REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
const WORKFLOW = /^[A-Za-z0-9._-]{1,100}\.ya?ml$/;
const BRANCH = /^[A-Za-z0-9._/-]{1,100}$/;
const MESSAGE_MAX = 120;

export interface GitHubBuildHistoryOptions {
  repo: string; // owner/name, public: no token is sent
  workflow?: string; // the workflow that builds and pushes the image
  branch?: string; // the branch Flux deploys from
  limit?: number;
  timeoutMs?: number;
}

/**
 * The image builds of one branch, read from the GitHub Actions runs of the image workflow: each
 * push to the branch is one run, carrying the commit it built. One call per read, public data only.
 */
export class GitHubBuildHistory implements BuildHistory {
  private readonly url: string;
  private readonly timeoutMs: number;

  constructor(
    private readonly get: GitHubGet,
    { repo, workflow = "image.yml", branch = "develop", limit = 10, timeoutMs = 3_000 }: GitHubBuildHistoryOptions,
  ) {
    if (!REPO.test(repo)) throw new Error(`repositório inválido: ${repo.slice(0, 60)}`);
    if (!WORKFLOW.test(workflow)) throw new Error(`workflow inválido: ${workflow.slice(0, 60)}`);
    if (!BRANCH.test(branch)) throw new Error(`branch inválida: ${branch.slice(0, 60)}`);
    const perPage = Math.min(Math.max(1, Math.floor(limit)), 30);
    const query = new URLSearchParams({ branch, event: "push", per_page: String(perPage) });
    this.url = `https://api.github.com/repos/${repo}/actions/workflows/${workflow}/runs?${query}`;
    this.timeoutMs = timeoutMs;
  }

  async builds(): Promise<BuildView[]> {
    let body: unknown;
    try {
      body = await this.get(this.url, AbortSignal.timeout(this.timeoutMs));
    } catch (err) {
      if (err instanceof GitHubApiError && err.rateLimited)
        throw new DeliveryUnavailable("a API do GitHub limitou as chamadas deste servidor; tente daqui a pouco", {
          cause: err,
        });
      if (err instanceof Error && err.name === "TimeoutError")
        throw new DeliveryUnavailable(`a API do GitHub não respondeu em ${this.timeoutMs} ms`, { cause: err });
      throw new DeliveryUnavailable("a API do GitHub está fora de alcance", { cause: err });
    }
    const parsed = runs.safeParse(body);
    if (!parsed.success) throw new DeliveryUnavailable("a API do GitHub respondeu num formato que não reconheço");
    return parsed.data.workflow_runs.map((run) => {
      const status = statusOf(run.status, run.conclusion);
      return {
        sha: run.head_sha,
        message: firstLine(run.head_commit?.message ?? ""),
        author: run.head_commit?.author?.name ?? "?",
        committedAt: run.head_commit?.timestamp ?? null,
        status,
        startedAt: run.run_started_at ?? run.created_at,
        finishedAt: status === "queued" || status === "running" ? null : run.updated_at,
        url: run.html_url,
      };
    });
  }
}

/** GitHub's status/conclusion pair folded into the five states the timeline draws. */
export function statusOf(status: string | null | undefined, conclusion: string | null | undefined): BuildStatus {
  if (status === "in_progress") return "running";
  if (status !== "completed") return "queued";
  if (conclusion === "success") return "success";
  if (conclusion === "cancelled" || conclusion === "skipped") return "cancelled";
  return "failure";
}

function firstLine(message: string): string {
  const line = message.split("\n", 1)[0].trim();
  return line.length > MESSAGE_MAX ? `${line.slice(0, MESSAGE_MAX - 1)}…` : line;
}
