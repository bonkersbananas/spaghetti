import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A throwaway self-signed certificate, as the printer's is (needs openssl, which every dev machine and runner has). */
export function selfSigned(commonName: string): { key: string; cert: string } {
  const dir = mkdtempSync(join(tmpdir(), "bridge-cert-"));
  try {
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        join(dir, "k"),
        "-out",
        join(dir, "c"),
        "-days",
        "2",
        "-subj",
        `/CN=${commonName}`,
      ],
      { stdio: "ignore" },
    );
    return { key: readFileSync(join(dir, "k"), "utf8"), cert: readFileSync(join(dir, "c"), "utf8") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
