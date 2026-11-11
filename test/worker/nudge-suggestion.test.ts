import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { toBase64Url } from "../../src/shared/base64url.ts";
import type { PushMessage } from "../../src/shared/push.ts";
import { sendNudges } from "../../src/worker/push/nudges.ts";
import { addUser, request, resetDb, signIn } from "./helpers.ts";

// What goes out is encrypted: look at the message before it is.
const sent: PushMessage[] = [];
const deliver = async (_env: unknown, _vapid: unknown, _device: unknown, message: PushMessage) => {
  sent.push(message);
  return "sent" as const;
};

const noon = Date.UTC(2026, 10, 10, 12);
let alex = "";

async function keys() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  return {
    p256dh: toBase64Url(new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer)),
    auth: toBase64Url(crypto.getRandomValues(new Uint8Array(16))),
  };
}

/** A print that came off the bed, with a photo Claude may have read. */
async function offTheBed(read?: { outcome: string; reason: string }) {
  const itemId = crypto.randomUUID();
  const attemptId = crypto.randomUUID();
  await request("/api/items", {
    method: "POST",
    cookie: alex,
    json: { id: itemId, title: "Tugboat", stage: "building" },
  });
  await request(`/api/items/${itemId}/attempts`, {
    method: "POST",
    cookie: alex,
    json: { id: attemptId, settings: {} },
  });
  await env.DB.prepare("UPDATE attempts SET printed_at = ?, ended_at = ? WHERE id = ?")
    .bind(noon - 3 * 3_600_000, noon - 300_000, attemptId)
    .run();
  if (read) {
    const photoId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO photos (id, item_id, position, width, height, color, content_type, created_by, created_at, attempt_id) SELECT ?, ?, 0, 10, 10, '#888888', 'image/jpeg', created_by, ?, ? FROM attempts WHERE id = ?",
    )
      .bind(photoId, itemId, noon - 400_000, attemptId, attemptId)
      .run();
    await env.DB.prepare(
      "INSERT INTO photo_reads (photo_id, attempt_id, item_id, status, outcome, failure_tags, success_notes, reason, created_at) VALUES (?, ?, ?, 'read', ?, '[]', '[]', ?, ?)",
    )
      .bind(photoId, attemptId, itemId, read.outcome, read.reason, noon - 390_000)
      .run();
  }
}

beforeEach(async () => {
  await resetDb();
  sent.length = 0;
  await addUser("alex", "correct horse", "Alex", "tomato");
  alex = await signIn("alex", "correct horse");
  const response = await request("/api/push/subscription", {
    method: "PUT",
    cookie: alex,
    json: { endpoint: "https://push.example/alex", keys: await keys(), timeZone: "UTC" },
  });
  expect(response.status).toBe(204);
});

describe("the nudge and Claude's guess", () => {
  it("says it looks like it worked, with the reason, and leads with that button", async () => {
    await offTheBed({ outcome: "success", reason: "Clean walls and a smooth top." });
    expect(await sendNudges(env, noon, deliver)).toEqual({ sent: 1 });
    expect(sent[0]?.title).toBe("Tugboat is off the bed");
    expect(sent[0]?.body).toBe("Looks like it worked: clean walls and a smooth top.");
    expect(sent[0]?.actions[0]?.action).toBe("success");
  });

  it("puts a suggested failure first", async () => {
    await offTheBed({ outcome: "failed", reason: "Stringy mess on the plate." });
    await sendNudges(env, noon, deliver);
    expect(sent[0]?.body).toBe("Looks like spaghetti: stringy mess on the plate.");
    expect(sent[0]?.actions.map((a) => a.action)).toEqual(["failed", "success", "partial"]);
  });

  it("asks the plain question when nothing was suggested", async () => {
    await offTheBed();
    await sendNudges(env, noon, deliver);
    expect(sent[0]?.body).toBe("How did it go?");
    expect(sent[0]?.actions.map((a) => a.action)).toEqual(["success", "partial", "failed"]);
  });
});
