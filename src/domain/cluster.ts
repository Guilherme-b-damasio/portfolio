export interface NodeView {
  name: string;
  ready: boolean;
  kubeletVersion: string;
  createdAt: string | null;
  cpuCapacityMilli: number;
  memoryCapacityBytes: number;
  cpuUsageMilli: number | null; // null when metrics-server is missing or slow
  memoryUsageBytes: number | null;
}

export interface PodView {
  namespace: string;
  name: string;
  phase: string; // Pending | Running | Succeeded | Failed | Unknown
  ready: string; // "1/1", as kubectl prints it
  restarts: number;
  node: string | null;
  startedAt: string | null;
  cpuUsageMilli: number | null;
  memoryUsageBytes: number | null;
}

/**
 * Read-only view of the cluster the site runs on. Only the namespaces it was given can be listed;
 * nothing here can create, change or delete anything.
 */
export interface ClusterReader {
  readonly namespaces: readonly string[];
  nodes(): Promise<NodeView[]>;
  pods(namespace: string): Promise<PodView[]>;
}

/** The cluster API could not be read right now. Its message is written for the visitor, so it names no host. */
export class ClusterUnavailable extends Error {
  override name = "ClusterUnavailable";
}

/** A namespace outside the whitelist. Its message is safe to show. */
export class NamespaceNotAllowed extends Error {
  override name = "NamespaceNotAllowed";
  constructor(namespace: string, allowed: readonly string[]) {
    super(`o namespace "${namespace.slice(0, 63)}" não é visível daqui; tente ${allowed.join(", ")}`);
  }
}
