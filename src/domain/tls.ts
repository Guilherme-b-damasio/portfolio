/** A byte range of the raw ClientHello, so the page can light up each field in the hex dump. */
export interface HelloField {
  offset: number;
  length: number;
  label: string; // "cipher_suites", "ext key_share"...
  kind: "record" | "handshake" | "version" | "random" | "session" | "ciphers" | "compression" | "extension" | "grease";
}

/** The parts of a TLS ClientHello that say which TLS library sent it. Codes are 4-digit lowercase hex, GREASE included. */
export interface ClientHello {
  legacyVersion: string;
  supportedVersions: string[];
  sni: string | null;
  alpn: string[];
  ciphers: string[]; // in packet order
  extensions: string[]; // in packet order
  signatureAlgorithms: string[];
  groups: string[];
  keyShareGroups: string[];
  bytes: number;
  hex: string; // the raw handshake, capped, for the annotated dump
  fields: HelloField[];
}

export interface TlsFingerprint {
  ja4: string;
  ja4r: string; // the sorted lists before hashing, for the curious
  hello: ClientHello;
}

/** A real handshake captured from a known client, shown next to the visitor's for comparison. */
export interface TlsSample {
  id: string;
  label: string;
  client: string;
  fingerprint: TlsFingerprint;
}

export interface TlsSampleSource {
  samples(): TlsSample[];
}

/** What the page needs to draw a handshake: the fingerprint, the stack behind it and the annotated bytes. */
export interface TlsView {
  ja4: string;
  ja4r: string;
  stack: string;
  bytes: number;
  hex: string;
  fields: HelloField[];
}

/**
 * What was read off a connection before TLS started, looked up by the socket's address:
 * the handshake's fingerprint and, behind a TCP proxy, the visitor's real address.
 */
export interface TappedConnections {
  fingerprint(remoteAddress: string, remotePort: number): TlsFingerprint | null;
  /** The address a trusted TCP proxy announced with the PROXY protocol; null when there was none. */
  clientAddress(remoteAddress: string, remotePort: number): string | null;
}

/** GREASE values (RFC 8701): 0x0a0a, 0x1a1a ... 0xfafa. Chromium and Apple sprinkle them to keep servers tolerant. */
export function isGrease(code: string): boolean {
  return /^([0-9a-f])a\1a$/.test(code);
}
