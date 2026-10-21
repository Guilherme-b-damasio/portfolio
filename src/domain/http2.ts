/** One SETTINGS parameter the client announced, in the order it sent them. */
export interface Http2Setting {
  id: number;
  name: string; // "HEADER_TABLE_SIZE", "INITIAL_WINDOW_SIZE"... or the hex id when unknown
  value: number;
}

/** A stream priority, from a PRIORITY frame or from the HEADERS frame's own priority block. */
export interface Http2Priority {
  stream: number;
  exclusive: boolean;
  dependsOn: number;
  weight: number; // 1-256, as RFC 9113 counts it (the wire carries weight - 1)
}

/** A frame header seen before the first request, for the curious. */
export interface Http2Frame {
  type: string; // "SETTINGS", "WINDOW_UPDATE", "HEADERS"... or the hex type when unknown
  stream: number;
  length: number;
  flags: number;
}

/**
 * What an HTTP/2 client sends before and with its first request: the parts every implementation
 * fills in its own way, which is what makes them recognisable.
 */
export interface Http2Preface {
  settings: Http2Setting[];
  /** The connection-level WINDOW_UPDATE increment sent before the first request; null when there was none. */
  windowUpdate: number | null;
  priorities: Http2Priority[]; // PRIORITY frames before the first request
  headerPriority: Http2Priority | null; // the first HEADERS frame's priority block, when it has one
  pseudoHeaders: string[]; // [":method", ":authority", ":scheme", ":path"] in the order they came
  frames: Http2Frame[];
  bytes: number;
}

export interface Http2Fingerprint {
  /** Akamai's format (Black Hat EU 2017): SETTINGS|WINDOW_UPDATE|PRIORITY|pseudo-header order. */
  akamai: string;
  hash: string; // MD5 of `akamai`, the form most fingerprint databases index
  preface: Http2Preface;
}

/** The HTTP/2 fingerprint of a connection, looked up by its peer's address; null for HTTP/1.1 connections. */
export interface Http2Connections {
  http2(remoteAddress: string, remotePort: number): Http2Fingerprint | null;
}
