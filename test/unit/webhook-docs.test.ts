import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { describe, expect, it } from "vitest";

/** The verification example in docs/api.md is real code: it is run here against a signature made the way the Worker makes one. */
async function loadVerify() {
  const doc = readFileSync(new URL("../../docs/api.md", import.meta.url), "utf8");
  const code = /```ts\n(export async function verify[\s\S]*?)```/.exec(doc)?.[1];
  if (!code) throw new Error("The verification example is gone from docs/api.md");
  const js = stripTypeScriptTypes(code);
  const module = (await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`)) as {
    verify: (secret: string, headers: Headers, body: string, toleranceSeconds?: number) => Promise<boolean>;
  };
  return module.verify;
}

const secret = "whsec_example-secret-for-the-docs";
const body = JSON.stringify({ deliveryId: "d", changes: [], cursor: 1 });
const signed = (timestamp: string, text = body) =>
  new Headers({
    "Spaghetti-Timestamp": timestamp,
    "Spaghetti-Signature": `v1=${createHmac("sha256", secret).update(`${timestamp}.${text}`).digest("hex")}`,
  });
const nowSeconds = () => String(Math.floor(Date.now() / 1000));

describe("the documented webhook verification", () => {
  it("accepts a good signature and refuses everything else", async () => {
    const verify = await loadVerify();
    expect(await verify(secret, signed(nowSeconds()), body)).toBe(true);
    expect(await verify("whsec_another", signed(nowSeconds()), body)).toBe(false);
    expect(await verify(secret, signed(nowSeconds()), `${body} `)).toBe(false);
    // Old, even when correctly signed.
    expect(await verify(secret, signed(String(Math.floor(Date.now() / 1000) - 3600)), body)).toBe(false);
    for (const signature of ["", "v1=", "v1=zz", "v2=00", `${signed(nowSeconds()).get("Spaghetti-Signature")}00`]) {
      const headers = signed(nowSeconds());
      headers.set("Spaghetti-Signature", signature);
      expect(await verify(secret, headers, body), signature).toBe(false);
    }
    expect(await verify(secret, new Headers(), body)).toBe(false);
  });
});
