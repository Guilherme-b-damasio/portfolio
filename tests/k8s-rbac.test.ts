import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { KubernetesClusterReader } from "../src/infrastructure/cluster/kubernetes-cluster-reader.js";
import { KubernetesRolloutHistory } from "../src/infrastructure/cluster/kubernetes-rollout-history.js";

// Keeps k8s/rbac.yaml read-only and in step with the API paths the cluster reader actually calls.
const k8s = path.resolve(import.meta.dirname, "..", "k8s");
const docs = (file: string) =>
  readFileSync(path.join(k8s, file), "utf8")
    .replace(/\r\n/g, "\n")
    .split(/^---$/m)
    .map((doc) => doc.replace(/#.*$/gm, ""));
const field = (doc: string, name: string) =>
  new RegExp(String.raw`^\s*-?\s*${name}:\s*(.+)$`, "m").exec(doc)?.[1].trim();
const list = (text: string) =>
  text
    .trim()
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((s) => s.trim().replace(/^"|"$/g, ""));

interface Rule {
  kind: string;
  namespace?: string;
  group: string;
  resources: string[];
  verbs: string[];
}

function rules(): Rule[] {
  return docs("rbac.yaml")
    .filter((doc) => /^kind: (Cluster)?Role$/m.test(doc))
    .flatMap((doc) => {
      const kind = field(doc, "kind")!;
      const namespace = field(doc, "namespace");
      return doc
        .split(/^\s*- apiGroups:/m)
        .slice(1)
        .map((rule) => ({
          kind,
          namespace,
          group: list(rule.split("\n")[0])[0],
          resources: list(field(rule, "resources")!),
          verbs: list(field(rule, "verbs")!),
        }));
    });
}

// "/apis/metrics.k8s.io/v1beta1/namespaces/x/pods" → group metrics.k8s.io, resource pods, in namespace x.
function needOf(apiPath: string) {
  const parts = new URL(apiPath, "http://x").pathname.split("/").filter(Boolean);
  const group = parts[0] === "api" ? "" : parts[1];
  const rest = parts.slice(parts[0] === "api" ? 2 : 3);
  return rest[0] === "namespaces"
    ? { group, resource: rest[2], namespace: rest[1] }
    : { group, resource: rest[0], namespace: undefined };
}

describe("k8s/rbac.yaml", () => {
  it("only ever reads, and never secrets or wildcards", () => {
    const all = rules();
    expect(all.length).toBeGreaterThan(0);
    for (const rule of all) {
      expect(rule.verbs.every((v) => v === "get" || v === "list")).toBe(true);
      expect(rule.resources.every((r) => ["nodes", "pods", "replicasets"].includes(r))).toBe(true);
      expect(rule.group).not.toBe("*");
    }
  });

  it("grants every path the cluster readers call, nodes cluster-wide and the rest per namespace", async () => {
    const calls: string[] = [];
    const get = async (apiPath: string) => {
      calls.push(apiPath);
      return { items: [] };
    };
    const reader = new KubernetesClusterReader(get, { namespaces: ["portfolio"] });
    await reader.nodes();
    await reader.pods("portfolio");
    await new KubernetesRolloutHistory(get, {
      namespace: "portfolio",
      deployment: "portfolio",
      selector: "app=portfolio",
    }).rollouts();
    expect(calls).toHaveLength(6);
    for (const call of calls) {
      const need = needOf(call);
      const granted = rules().some(
        (r) =>
          r.group === need.group &&
          r.resources.includes(need.resource) &&
          r.verbs.includes("list") &&
          (need.namespace ? r.kind === "Role" && r.namespace === need.namespace : r.kind === "ClusterRole"),
      );
      expect(granted, `nothing in k8s/rbac.yaml grants ${call}`).toBe(true);
    }
  });

  it("binds the service account the deployment runs as, over the namespaces it lists", () => {
    const deployment = docs("deployment.yaml").find((doc) => /^kind: Deployment$/m.test(doc))!;
    expect(field(deployment, "serviceAccountName")).toBe("portfolio");
    const namespaces = /name: CLUSTER_NAMESPACES.*\n\s*value: (.+)/.exec(deployment)![1].split(",");
    const roles = rules().filter((r) => r.kind === "Role");
    for (const ns of namespaces) expect(roles.some((r) => r.namespace === ns.trim())).toBe(true);
    const bindings = docs("rbac.yaml").filter((doc) => /^kind: (Cluster)?RoleBinding$/m.test(doc));
    expect(bindings).toHaveLength(2);
    for (const binding of bindings) expect(binding).toMatch(/kind: ServiceAccount\n\s*name: portfolio\n/);
  });
});
