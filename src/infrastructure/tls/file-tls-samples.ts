import { readFile } from "node:fs/promises";
import path from "node:path";
import type { TlsSample, TlsSampleSource } from "../../domain/tls.js";
import { parseClientHello } from "./client-hello.js";
import { ja4 } from "./ja4.js";

interface Manifest {
  file: string;
  label: string;
  client: string;
}

/** Captured ClientHellos stored as hex next to a samples.json that says who sent each one. */
export class FileTlsSamples implements TlsSampleSource {
  private constructor(private readonly loaded: TlsSample[]) {}

  static async load(dir: string): Promise<FileTlsSamples> {
    const manifest = JSON.parse(await readFile(path.join(dir, "samples.json"), "utf8")) as Manifest[];
    const loaded = await Promise.all(
      manifest.map(async ({ file, label, client }) => {
        const hex = (await readFile(path.join(dir, file), "utf8")).trim();
        return {
          id: path.basename(file, ".hex"),
          label,
          client,
          fingerprint: ja4(parseClientHello(Buffer.from(hex, "hex"))),
        };
      }),
    );
    return new FileTlsSamples(loaded);
  }

  samples(): TlsSample[] {
    return this.loaded;
  }
}
