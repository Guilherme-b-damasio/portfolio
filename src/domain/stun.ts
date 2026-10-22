import type { Verdict } from "./exposure.js";

/**
 * The STUN test (RFC 8489): the browser gathers ICE candidates against this server's own UDP
 * sockets, so the binding requests reaching us carry the address and port the visitor's NAT really
 * uses. Two sockets on different ports show how that NAT maps a single socket of theirs.
 */

/** One binding request that reached a STUN socket of ours. */
export interface StunSighting {
  address: string; // the reflexive address: where the NAT sent the request from
  port: number; // the reflexive port, the interesting half
  serverPort: number; // which of our sockets answered
  software: string | null; // the SOFTWARE attribute, when the client sent one
  at: string;
}

/** Keeps the recent binding requests, by the address they came from, for a couple of minutes. */
export interface NatBindings {
  record(sighting: Omit<StunSighting, "at">): void;
  /** Recent sightings from one address, oldest first. Empty when nothing arrived. */
  forAddress(address: string): StunSighting[];
}

/**
 * How the NAT builds the mapping, as far as one server with two ports can tell:
 * - `sem-nat`: the reflexive port is the one the browser used, so nothing is translating.
 * - `porta-fixa`: both of our ports saw the same reflexive port (endpoint-independent mapping),
 *   which is what makes peer-to-peer work without a relay.
 * - `porta-por-destino`: each of our ports saw a different one (address/port-dependent mapping,
 *   the "symmetric" NAT), so holes punched with us are useless to a peer and a TURN relay is needed.
 */
export type NatMapping = "sem-nat" | "porta-fixa" | "porta-por-destino" | "desconhecido";

export interface StunView {
  address: string;
  ports: number[]; // the reflexive ports, one per socket of ours that was reached
  serverPorts: number[];
  software: string | null;
  at: string;
}

export interface NatReport {
  you: { ip: string }; // the address the page itself came from
  servers: { port: number }[]; // the sockets the browser can aim at
  sightings: StunView[];
  mapping: NatMapping;
  matchesHttp: boolean | null; // did the UDP address match the one this page came over? null without sightings
  pending: boolean; // nothing arrived yet: WebRTC may be blocked, or the port may not be open
  verdict: Verdict;
  headline: string;
  detail: string;
}
