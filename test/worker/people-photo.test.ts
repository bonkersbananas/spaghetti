import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { NewTokenResponse } from "../../src/shared/agents.ts";
import type { PeopleResponse, SessionResponse } from "../../src/shared/api.ts";
import type { ChangesResponse } from "../../src/shared/changes.ts";
import { addUser, request, resetDb, signIn } from "./helpers.ts";

let alex: string;
let cookie: string;
let samCookie: string;

beforeEach(async () => {
  await resetDb();
  alex = await addUser("alex", "correct horse", "Alex Rivera", "tomato");
  await addUser("sam", "battery staple", "Sam Lund", "basil");
  cookie = await signIn("alex", "correct horse");
  samCookie = await signIn("sam", "battery staple");
});

function upload(as: string, bytes = 2048, type = "image/webp") {
  const form = new FormData();
  form.set("photo", new File([new Uint8Array(bytes).fill(7)], "me", { type }));
  return request("/api/people/me/photo", { method: "PUT", body: form, cookie: as });
}

const people = async (as: string) =>
  (await (await request("/api/people", { cookie: as })).json<PeopleResponse>()).people;

describe("profile pictures", () => {
  it("starts with initials", async () => {
    expect((await people(cookie)).map((p) => p.photoUrl)).toEqual([null, null]);
  });

  it("sets a picture the other person can fetch, under a versioned address", async () => {
    const response = await upload(cookie);
    expect(response.status).toBe(200);
    const { user } = await response.json<SessionResponse>();
    expect(user.photoUrl).toMatch(new RegExp(`^/api/people/${alex}/photo\\?v=[0-9a-f]{8}$`));
    expect((await people(samCookie)).find((p) => p.id === alex)?.photoUrl).toBe(user.photoUrl);
    const bytes = await request(user.photoUrl ?? "", { cookie: samCookie });
    expect(bytes.status).toBe(200);
    expect(bytes.headers.get("Content-Type")).toBe("image/webp");
    expect(bytes.headers.get("Cache-Control")).toContain("immutable");
    expect((await bytes.arrayBuffer()).byteLength).toBe(2048);
    expect((await request(user.photoUrl ?? "")).status).toBe(401);
  });

  it("a new picture gets a new address and the old bytes go", async () => {
    const first = (await (await upload(cookie)).json<SessionResponse>()).user.photoUrl;
    const before = (await env.PHOTOS.list({ prefix: "people/" })).objects.length;
    const second = (await (await upload(cookie, 1024, "image/jpeg")).json<SessionResponse>()).user.photoUrl;
    expect(second).not.toBe(first);
    expect((await env.PHOTOS.list({ prefix: "people/" })).objects.length).toBe(before);
  });

  it("refuses other types, empty and too-large pictures", async () => {
    expect((await upload(cookie, 100, "image/png")).status).toBe(415);
    expect((await upload(cookie, 0)).status).toBe(413);
    expect((await upload(cookie, 600 * 1024)).status).toBe(413);
    const form = new FormData();
    form.set("photo", "text");
    expect((await request("/api/people/me/photo", { method: "PUT", body: form, cookie })).status).toBe(400);
    expect((await people(cookie)).every((p) => p.photoUrl === null)).toBe(true);
  });

  it("removes it, back to initials, and deletes the bytes", async () => {
    const before = (await env.PHOTOS.list({ prefix: "people/" })).objects.length;
    await upload(cookie);
    const response = await request("/api/people/me/photo", { method: "DELETE", cookie });
    expect(response.status).toBe(200);
    expect((await response.json<SessionResponse>()).user.photoUrl).toBeNull();
    expect((await env.PHOTOS.list({ prefix: "people/" })).objects).toHaveLength(before);
    expect((await request("/api/people/me/photo", { method: "DELETE", cookie })).status).toBe(200);
  });

  it("only changes your own, and is in the feed", async () => {
    await upload(cookie);
    expect((await people(cookie)).find((p) => p.username === "sam")?.photoUrl).toBeNull();
    const feed = await request("/api/changes?after=0", { cookie: samCookie });
    const { changes } = await feed.json<ChangesResponse>();
    expect(changes.find((c) => c.entity === "person")).toMatchObject({ id: alex, action: "updated" });
  });

  it("is for people: a token reads the address but can't change it", async () => {
    await upload(cookie);
    const made = await request("/api/agents", {
      method: "POST",
      json: { name: "Claude for Alex", scopes: ["read", "capture"] },
      cookie,
    });
    const { token } = await made.json<NewTokenResponse>();
    const asAgent = (path: string, init: RequestInit = {}) =>
      request(path, { ...init, headers: { Authorization: `Bearer ${token}`, Origin: "http://other.test" } });
    const list = await asAgent("/api/people");
    expect((await list.json<PeopleResponse>()).people.some((p) => p.photoUrl)).toBe(true);
    const form = new FormData();
    form.set("photo", new File([new Uint8Array(10)], "x", { type: "image/webp" }));
    expect((await asAgent("/api/people/me/photo", { method: "PUT", body: form })).status).toBe(403);
    expect((await asAgent("/api/people/me/photo", { method: "DELETE" })).status).toBe(403);
  });
});
