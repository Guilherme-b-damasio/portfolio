import type { TlsSampleSource, TlsView } from "../domain/tls.js";
import { tlsView } from "./scan/tls-stack.js";

export interface TlsSampleView extends TlsView {
  id: string;
  label: string;
  client: string;
}

/** Real handshakes from known clients, so a visitor can compare theirs, or see one when TLS ends at the proxy. */
export class BrowseTlsSamples {
  private readonly views: TlsSampleView[];

  constructor(source: TlsSampleSource) {
    // Samples never change while the process runs: classify them once.
    this.views = source
      .samples()
      .map(({ id, label, client, fingerprint }) => ({ id, label, client, ...tlsView(fingerprint) }));
  }

  list(): TlsSampleView[] {
    return this.views;
  }
}
