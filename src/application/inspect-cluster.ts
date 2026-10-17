import type { ClusterReader, NodeView, PodView } from "../domain/cluster.js";

export interface ClusterOverview {
  namespaces: readonly string[];
  nodes: NodeView[];
  pods: PodView[]; // every whitelisted namespace, sorted by namespace then name
}

/**
 * What `kubectl get` and the "Cluster" panel show. Without a reader (outside a cluster, or with
 * the service account token not mounted) it is off and says so; it never reaches anything else.
 */
export class InspectCluster {
  constructor(private readonly reader: ClusterReader | null) {}

  get enabled(): boolean {
    return this.reader !== null;
  }

  get namespaces(): readonly string[] {
    return this.reader?.namespaces ?? [];
  }

  async overview(): Promise<ClusterOverview> {
    const reader = this.required();
    const [nodes, ...perNamespace] = await Promise.all([
      reader.nodes(),
      ...reader.namespaces.map((ns) => reader.pods(ns)),
    ]);
    return { namespaces: reader.namespaces, nodes, pods: perNamespace.flat().sort(byName) };
  }

  /** Pods of one namespace, the first whitelisted one when none is given. Throws NamespaceNotAllowed. */
  async pods(namespace?: string): Promise<PodView[]> {
    const reader = this.required();
    return (await reader.pods(namespace ?? reader.namespaces[0])).sort(byName);
  }

  async nodes(): Promise<NodeView[]> {
    return this.required().nodes();
  }

  private required(): ClusterReader {
    if (!this.reader) throw new ClusterOff();
    return this.reader;
  }
}

/** The use case has no reader: this server is not running inside a cluster. */
export class ClusterOff extends Error {
  override name = "ClusterOff";
  constructor() {
    super("este servidor não está rodando num cluster agora, então não há pods para listar");
  }
}

const byName = (a: PodView, b: PodView) => a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name);
