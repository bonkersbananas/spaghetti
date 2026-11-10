/**
 * pnpm vapid:generate --out FILE — makes the VAPID key pair web push is signed with.
 *
 * The private key goes to FILE (mode 600, never printed, never overwritten); the public key is printed:
 * it is not secret and goes in wrangler.jsonc (`vars.VAPID_PUBLIC_KEY`). Then, from the same shell:
 *
 *   pnpm exec wrangler secret put VAPID_PRIVATE_KEY < FILE && rm FILE
 *
 * See docs/deploy.md ("Push notifications"). A keypair for local development goes in .dev.vars instead
 * (`--dev-vars` appends both lines to it).
 */
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { toBase64Url } from "../src/shared/base64url.ts";

const { values } = parseArgs({ options: { out: { type: "string" }, "dev-vars": { type: "boolean" } } });
if (!values.out && !values["dev-vars"]) {
  console.error("Say where the private key goes: --out FILE (for wrangler secret put) or --dev-vars.");
  process.exit(1);
}

const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const publicKey = toBase64Url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
if (!jwk.d) throw new Error("No private key came out");

if (values.out) {
  if (existsSync(values.out)) {
    console.error(`${values.out} already exists; not overwriting it.`);
    process.exit(1);
  }
  writeFileSync(values.out, jwk.d, { mode: 0o600, flag: "wx" });
  console.log(`Private key written to ${values.out} (mode 600).`);
}
if (values["dev-vars"]) {
  appendFileSync(".dev.vars", `\nVAPID_PUBLIC_KEY=${publicKey}\nVAPID_PRIVATE_KEY=${jwk.d}\n`, { mode: 0o600 });
  console.log("Both keys appended to .dev.vars (which is never committed).");
}
console.log(`Public key: ${publicKey}`);
