/** Trades a pairing code from the app for the bridge's token. */
import type { PairResponse } from "../../src/shared/bridge.ts";

export class PairingError extends Error {}

export async function pairWithApp(appUrl: string, code: string, fetcher: typeof fetch = fetch): Promise<PairResponse> {
  const base = appUrl.replace(/\/+$/, "");
  let response: Response;
  try {
    response = await fetcher(`${base}/api/bridge/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new PairingError(`Couldn't reach Spaghetti at ${base}. Is this computer online?`);
  }
  if (response.status === 410) {
    throw new PairingError("That code was used or has expired. Make a new one on the Printer page in Spaghetti.");
  }
  if (response.status === 429) throw new PairingError("Too many tries. Wait a few minutes and use a new code.");
  if (!response.ok) throw new PairingError(`Spaghetti answered ${response.status}. Try again in a minute.`);
  const body = (await response.json().catch(() => null)) as PairResponse | null;
  if (!body?.token?.startsWith("spg_")) throw new PairingError("Spaghetti's answer wasn't what the bridge expected.");
  return { ...body, appUrl: body.appUrl || base };
}
