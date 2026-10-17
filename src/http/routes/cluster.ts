import express from "express";
import { ClusterOff, type InspectCluster } from "../../application/inspect-cluster.js";
import { ClusterUnavailable, NamespaceNotAllowed } from "../../domain/cluster.js";

/**
 * The cluster, read-only: GET /api/cluster (nodes and every visible pod), /api/cluster/nodes and
 * /api/cluster/pods?namespace=. Reads are cached a few seconds upstream, so visitors cannot fan out
 * calls to the API server; failures answer with a message that is safe to show.
 */
export function clusterRouter(cluster: InspectCluster) {
  const router = express.Router();

  const reply =
    (read: (req: express.Request) => Promise<object>): express.RequestHandler =>
    async (req, res, next) => {
      try {
        res.json({ ...(await read(req)), readAt: new Date().toISOString() });
      } catch (err) {
        if (err instanceof ClusterOff) {
          res.status(503).json({ error: err.message, off: true });
        } else if (err instanceof ClusterUnavailable) {
          res.set("Retry-After", "10").status(503).json({ error: err.message });
        } else if (err instanceof NamespaceNotAllowed) {
          res.status(403).json({ error: err.message, namespaces: cluster.namespaces });
        } else {
          next(err);
        }
      }
    };

  router.get(
    "/",
    reply(() => cluster.overview()),
  );
  router.get(
    "/nodes",
    reply(async () => ({ nodes: await cluster.nodes() })),
  );
  router.get(
    "/pods",
    reply(async (req) => {
      const namespace = typeof req.query.namespace === "string" ? req.query.namespace : undefined;
      return { namespace: namespace ?? cluster.namespaces[0], pods: await cluster.pods(namespace) };
    }),
  );

  return router;
}
