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
 * - `porta-fixa`: both of our ports saw the same reflexive port (endpoint-independent mapping),
 *   which is what makes peer-to-peer work without a relay.
 * - `porta-por-destino`: each of our ports saw a different one (address/port-dependent mapping,
 *   the "symmetric" NAT), so a hole punched with us is useless to a peer and a TURN relay is needed.
 * - `desconhecido`: only one of the two sockets was reached, so there is nothing to compare.
 */
export type NatMapping = "porta-fixa" | "porta-por-destino" | "desconhecido";

/** One reflexive port of the visitor, and which of our sockets saw it. */
export interface StunView {
  port: number;
  serverPorts: number[];
  software: string | null;
  at: string;
}

/** A socket of ours the browser can aim at: the host is null when it is this same page's. */
export interface StunEndpoint {
  host: string | null;
  port: number;
}

/** A reflexive address the browser says it was given, which this server does not take on faith. */
export interface ClaimedAddress {
  address: string;
  port: number;
}

export interface NatReport {
  you: { ip: string }; // the address this page came over
  servers: StunEndpoint[];
  sightings: StunView[]; // what our sockets saw coming from that same address
  browser: ClaimedAddress[]; // what the browser says our sockets answered it
  mapping: NatMapping;
  matchesHttp: boolean | null; // the UDP left by the address this page came over? null with nothing to tell
  pending: boolean; // nothing arrived yet: WebRTC may be blocked, or the port may not be open
  verdict: Verdict;
  headline: string;
  detail: string;
}
