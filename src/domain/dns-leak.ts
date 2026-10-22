import type { Verdict } from "./exposure.js";

/**
 * The DNS leak test: the page resolves a random name under a zone this server is authoritative for,
 * so the query that reaches us comes from whichever resolver the visitor's system really uses.
 */

/** The subnet a resolver forwarded on the visitor's behalf (EDNS Client Subnet, RFC 7871). */
export interface ClientSubnet {
  family: 4 | 6;
  address: string; // the network part, e.g. "200.150.1.0"
  prefix: number; // source prefix length, e.g. 24
}

/** One query that reached the authoritative server for a probe. */
export interface ResolverSighting {
  address: string; // the resolver's own address, as the UDP packet came from it
  qtype: string; // "A", "AAAA"...
  clientSubnet: ClientSubnet | null;
  at: string; // ISO time of the first query from this resolver
}

/**
 * mesma-rede: the resolver sits on the visitor's own network (their ISP, or their VPN's).
 * publico: a known public resolver (Google, Cloudflare, Quad9...). outra-rede: neither, which is
 * what a VPN that lets DNS escape looks like, and also a company or school resolver.
 */
export type ResolverRelation = "mesma-rede" | "publico" | "outra-rede";

export interface ResolverView {
  address: string;
  qtypes: string[];
  reverseDns: string | null;
  operator: string | null; // "Google", "Cloudflare"... when it is a known public resolver
  relation: ResolverRelation;
  clientSubnet: ClientSubnet | null;
  subnetHasYou: boolean | null; // does the forwarded subnet contain the visitor's IP? null without one
  at: string;
}

export interface LeakReport {
  token: string;
  you: { ip: string; reverseDns: string | null };
  resolvers: ResolverView[];
  pending: boolean; // no resolver asked yet: the browser may not have resolved the name
  verdict: Verdict;
  headline: string;
  detail: string;
}

/** A random name handed to one visitor. Only issued names are recorded, so nobody can fill the store. */
export interface LeakProbe {
  token: string;
  hostname: string; // `<token>.<zone>`
  expiresAt: string;
}

/** Issues probes and keeps what resolvers asked about them, for a few minutes only. */
export interface LeakProbes {
  issue(): LeakProbe | null; // null when the store is full
  /** Records a query for a token; false when the token was never issued or has expired. */
  record(token: string, sighting: Omit<ResolverSighting, "at">): boolean;
  /** null when the token is unknown or expired. */
  sightings(token: string): ResolverSighting[] | null;
}
