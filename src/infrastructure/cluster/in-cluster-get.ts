import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { KubeApiError, type KubeGet } from "./kubernetes-cluster-reader.js";

export interface KubeGetOptions {
  baseUrl: string; // https://<service host>:<port> inside the pod; plain http only for tests
  token: () => string; // read per call: projected service account tokens are rotated by the kubelet
  ca?: Buffer;
  maxBytes?: number; // a response past this is cut off and treated as a failure
}

/** GET with the pod's service account token, answering parsed JSON; nothing else is ever sent. */
export function kubeGet({ baseUrl, token, ca, maxBytes = 2_000_000 }: KubeGetOptions): KubeGet {
  const base = new URL(baseUrl);
  const client = base.protocol === "https:" ? https : http;
  return (apiPath, signal) =>
    new Promise((resolve, reject) => {
      const req = client.request(
        new URL(apiPath, base),
        { method: "GET", headers: { authorization: `Bearer ${token()}`, accept: "application/json" }, ca, signal },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size <= maxBytes) return chunks.push(chunk);
            reject(new Error(`resposta acima de ${maxBytes} bytes`));
            res.destroy();
          });
          res.on("error", reject);
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            const status = res.statusCode ?? 0;
            if (status < 200 || status >= 300) return reject(new KubeApiError(status, `GET ${apiPath}: ${status}`));
            try {
              resolve(JSON.parse(text));
            } catch (err) {
              reject(err);
            }
          });
        },
      );
      req.on("error", (err) => reject(signal.aborted ? signal.reason : err));
      req.end();
    });
}

const SERVICE_ACCOUNT = "/var/run/secrets/kubernetes.io/serviceaccount";

/** The pod's own API access, or null outside a cluster (or with automountServiceAccountToken off). */
export function inClusterGet(env: NodeJS.ProcessEnv = process.env, dir = SERVICE_ACCOUNT): KubeGet | null {
  const host = env.KUBERNETES_SERVICE_HOST;
  const port = env.KUBERNETES_SERVICE_PORT ?? "443";
  let ca: Buffer;
  try {
    ca = readFileSync(path.join(dir, "ca.crt"));
  } catch {
    return null;
  }
  if (!host) return null;
  const hostPart = host.includes(":") ? `[${host}]` : host; // IPv6 service addresses
  return kubeGet({
    baseUrl: `https://${hostPart}:${port}`,
    token: () => readFileSync(path.join(dir, "token"), "utf8").trim(),
    ca,
  });
}
