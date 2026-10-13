import type { RequestHandler } from "express";
import type { TappedConnections } from "../../domain/tls.js";

/**
 * On a connection that came through a TCP proxy, the socket's peer is the proxy. When it announced
 * the visitor with the PROXY protocol, that address becomes req.ip, so rate limits and the scan see
 * the visitor and not the proxy. It also wins over any X-Forwarded-For the client wrote itself.
 */
export function proxiedClient(tapped: TappedConnections | null | undefined): RequestHandler {
  return (req, _res, next) => {
    const { remoteAddress, remotePort } = req.socket;
    const client = tapped && remoteAddress && remotePort ? tapped.clientAddress(remoteAddress, remotePort) : null;
    if (client) Object.defineProperty(req, "ip", { value: client, configurable: true, enumerable: true });
    next();
  };
}
