import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// A throwaway self-signed certificate, made with the openssl CLI. CI and Git for Windows both ship it.
export function selfSigned(): { key: Buffer; cert: Buffer } | null {
  const dir = mkdtempSync(path.join(os.tmpdir(), "tap-"));
  const file = (name: string) => path.join(dir, name);
  try {
    // Our own minimal config, so a stray OPENSSL_CONF on the machine can't break the test.
    writeFileSync(file("req.cnf"), ["[req]", "distinguished_name = dn", "[dn]", ""].join("\n"));
    const args = [
      "req",
      "-x509",
      "-config",
      file("req.cnf"),
      "-newkey",
      "ec",
      "-pkeyopt",
      "ec_paramgen_curve:prime256v1",
    ];
    args.push("-nodes", "-days", "1", "-subj", "/CN=localhost", "-keyout", file("k.pem"), "-out", file("c.pem"));
    execFileSync("openssl", args, { stdio: "ignore" });
    return { key: readFileSync(file("k.pem")), cert: readFileSync(file("c.pem")) };
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
