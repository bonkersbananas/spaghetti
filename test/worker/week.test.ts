import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PushMessage } from "../../src/shared/push.ts";
import { mondayOf, type Week, type WeekResponse } from "../../src/shared/week.ts";
import { sendWeekPush } from "../../src/worker/push/week.ts";
import { WEEK_NOTES_PER_DAY, writeWeekNote } from "../../src/worker/week/note.ts";
import { addUser, request, resetDb, signIn } from "./helpers.ts";

const at = (iso: string) => Date.parse(iso);
const uuid = () => crypto.randomUUID();
/** Wednesday evening of the week of Monday 12 January 2026. */
const wed = at("2026-01-14T18:00:00+01:00");

let cookie = "";
let alex = "";
let sam = "";

beforeEach(async () => {
  await resetDb();
  alex = await addUser("alex", "correct horse", "Alex Rivera", "tomato");
  sam = await addUser("sam", "another horse", "Sam", "sea");
  cookie = await signIn("alex", "correct horse");
});
afterEach(() => vi.restoreAllMocks());

// ---- Rows, written straight to D1 so their times are exact (the API stamps "now") ----

async function item(
  fields: {
    title?: string | null;
    stage?: string;
    by?: string;
    createdAt?: number;
    startedAt?: number | null;
    finishedAt?: number | null;
    upNext?: number | null;
    deleted?: boolean;
    note?: string;
  } = {},
) {
  const id = uuid();
  const createdAt = fields.createdAt ?? at("2026-01-14T12:00:00+01:00");
  await env.DB.prepare(
    `INSERT INTO items (id, stage, title, note, created_by, created_at, updated_at, deleted_at, started_at, finished_at, up_next)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      fields.stage ?? "building",
      fields.title === undefined ? "Tugboat" : fields.title,
      fields.note ?? "",
      fields.by ?? alex,
      createdAt,
      createdAt,
      fields.deleted ? createdAt + 1 : null,
      fields.startedAt === undefined ? createdAt : fields.startedAt,
      fields.finishedAt ?? null,
      fields.upNext ?? null,
    )
    .run();
  return id;
}

async function attempt(
  itemId: string,
  printedAt: number,
  fields: {
    outcome?: string | null;
    by?: string;
    settings?: object;
    deleted?: boolean;
    failureTags?: string[];
    note?: string;
  } = {},
) {
  const id = uuid();
  await env.DB.prepare(
    `INSERT INTO attempts (id, item_id, outcome, printed_at, note, failure_tags, settings, created_by, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      itemId,
      fields.outcome === undefined ? "success" : fields.outcome,
      printedAt,
      fields.note ?? "",
      JSON.stringify(fields.failureTags ?? []),
      JSON.stringify(fields.settings ?? {}),
      fields.by ?? alex,
      printedAt,
      printedAt,
      fields.deleted ? printedAt + 1 : null,
    )
    .run();
  return id;
}

async function photo(itemId: string, attemptId: string | null, createdAt: number, deleted = false) {
  const id = uuid();
  await env.DB.prepare(
    `INSERT INTO photos (id, item_id, position, width, height, color, content_type, created_by, created_at, attempt_id, deleted_at)
     VALUES (?, ?, 0, 800, 600, '#aabbcc', 'image/webp', ?, ?, ?, ?)`,
  )
    .bind(id, itemId, alex, createdAt, attemptId, deleted ? createdAt + 1 : null)
    .run();
  return id;
}

async function comment(itemId: string, authorId: string, createdAt: number, deleted = false) {
  await env.DB.prepare(
    "INSERT INTO comments (id, item_id, author_id, body, created_at, deleted_at) VALUES (?, ?, ?, 'hi', ?, ?)",
  )
    .bind(uuid(), itemId, authorId, createdAt, deleted ? createdAt + 1 : null)
    .run();
}

const week = async (monday: string): Promise<Week> => {
  const response = await request(`/api/weeks/${monday}`, { cookie });
  expect(response.status).toBe(200);
  return (await response.json<WeekResponse>()).week;
};

const MONDAY = "2026-01-12";

describe("GET /api/weeks/:monday", () => {
  it("works out the week's figures: prints, builds, ideas, comments and filament", async () => {
    const tug = await item({ title: "Tugboat" });
    const worked = await attempt(tug, wed, { settings: { filaments: [{ type: "PLA", grams: 20 }] } });
    await attempt(tug, wed + 1000, { outcome: "failed", settings: { weightGrams: 40, failedAtPercent: 50 } });
    await attempt(tug, wed + 2000, { outcome: "partial" });
    await attempt(tug, wed + 3000, { outcome: null, by: sam });
    const finished = await item({
      title: "Cable comb",
      stage: "done",
      finishedAt: wed,
      createdAt: at("2026-10-01T10:00:00Z"),
    });
    const idea = await item({ title: "A vase", stage: "idea", startedAt: null, by: sam, createdAt: wed });
    await item({ title: null, stage: "idea", startedAt: null, note: "  a hook\nfor the garage  ", createdAt: wed + 5 });
    await comment(idea, alex, wed);
    await comment(idea, sam, wed + 1);
    await comment(tug, sam, wed + 2);

    const result = await week(MONDAY);
    expect(result).toMatchObject({
      monday: MONDAY,
      sunday: "2026-01-18",
      timeZone: "Europe/Stockholm",
      prints: { total: 4, worked: 1, partly: 1, spaghetti: 1, printing: 1 },
      grams: 40, // 20 g that worked and half of the failed 40 g
      gramsApproximate: true,
      empty: false,
      note: null,
    });
    // Worked first, then partly, then spaghetti.
    expect(result.made.map((print) => print.outcome)).toEqual(["success", "partial", "failed"]);
    expect(result.made[0]).toMatchObject({ attemptId: worked, itemId: tug, title: "Tugboat", attempt: 1, by: alex });
    expect(result.made.map((print) => print.attempt)).toEqual([1, 3, 2]);
    expect(result.onTheBed.map((print) => [print.attempt, print.by])).toEqual([[4, sam]]);
    expect(result.buildsFinished).toEqual([{ id: finished, title: "Cable comb", at: wed }]);
    expect(result.ideas.map((entry) => [entry.title, entry.note, entry.by])).toEqual([
      [null, "a hook for the garage", alex],
      ["A vase", "", sam],
    ]);
    expect(result.comments.total).toBe(3);
    expect(result.comments.byPerson).toEqual({ [alex]: 1, [sam]: 2 });
    expect(result.comments.threads.map((thread) => [thread.title, thread.count])).toEqual([
      ["A vase", 2],
      ["Tugboat", 1],
    ]);
  });

  it("shows each finished print's final photo, newest first, and leaves out deleted ones", async () => {
    const tug = await item();
    const printed = await attempt(tug, wed);
    await photo(tug, printed, wed + 10);
    const final = await photo(tug, printed, wed + 20);
    await photo(tug, printed, wed + 30, true);
    const bare = await attempt(tug, wed + 5000);
    const result = await week(MONDAY);
    const withPhoto = result.made.find((print) => print.attemptId === printed);
    expect(withPhoto?.photo).toEqual({ id: final, color: "#aabbcc", width: 800, height: 600 });
    // The print with a picture leads, within its outcome.
    expect(result.made.map((print) => print.attemptId)).toEqual([printed, bare]);
    expect(result.made[1]?.photo).toBeNull();
  });

  it("cuts weeks at Sunday midnight in Stockholm, not UTC", async () => {
    const build = await item();
    const lastSecond = await attempt(build, at("2026-01-18T23:59:59+01:00"));
    const firstSecond = await attempt(build, at("2026-01-19T00:00:00+01:00"));
    // 23:30 UTC on Sunday is half past midnight on Monday in Stockholm.
    const lateUtc = await attempt(build, at("2026-01-18T23:30:00Z"));
    const startOfWeek = await attempt(build, at("2026-01-12T00:00:00+01:00"));
    const justBefore = await attempt(build, at("2026-01-11T23:59:59+01:00"));
    const ids = (result: Week) => result.made.map((print) => print.attemptId).sort();
    expect(ids(await week("2026-01-12"))).toEqual([lastSecond, startOfWeek].sort());
    expect(ids(await week("2026-01-19"))).toEqual([firstSecond, lateUtc].sort());
    expect(ids(await week("2026-01-05"))).toEqual([justBefore]);
  });

  it("counts a daylight-saving week by the clock on the wall", async () => {
    // Clocks went back at 03:00 on Sunday 25 Oct 2026, so that Sunday 23:30 is UTC+1 and the week ends an hour later.
    const build = await item();
    const sundayNight = await attempt(build, at("2026-10-25T23:30:00+01:00"));
    const mondayMorning = await attempt(build, at("2026-10-26T00:10:00+01:00"));
    expect((await week("2026-10-19")).made.map((print) => print.attemptId)).toEqual([sundayNight]);
    expect((await week("2026-10-26")).made.map((print) => print.attemptId)).toEqual([mondayMorning]);
  });

  it("puts a print that spans the weekend in the week it was printed in, whenever it was finished", async () => {
    const build = await item();
    // Started Sunday 23:30, answered on Monday (finished_at is Monday's): the week it started in.
    const spanning = await attempt(build, at("2026-01-18T23:30:00+01:00"), { outcome: null });
    await env.DB.prepare("UPDATE attempts SET outcome = 'success', finished_at = ? WHERE id = ?")
      .bind(at("2026-01-19T09:00:00+01:00"), spanning)
      .run();
    const first = await week("2026-01-12");
    const second = await week("2026-01-19");
    expect(first.prints).toMatchObject({ total: 1, worked: 1, printing: 0 });
    expect(second.prints.total).toBe(0);
  });

  it("leaves out whatever is deleted: attempts, builds, ideas, comments and photos", async () => {
    const live = await item({ title: "Live" });
    await attempt(live, wed);
    await attempt(live, wed + 1, { deleted: true });
    const gone = await item({ title: "Gone", deleted: true });
    await attempt(gone, wed);
    await comment(gone, alex, wed);
    await comment(live, alex, wed, true);
    await item({ title: "A deleted idea", stage: "idea", startedAt: null, deleted: true, createdAt: wed });
    await item({ title: "A deleted finish", stage: "done", finishedAt: wed, deleted: true });
    const result = await week(MONDAY);
    expect(result.prints.total).toBe(1);
    expect(result.made).toHaveLength(1);
    expect(result.made[0]?.attempt).toBe(1);
    expect(result.comments.total).toBe(0);
    expect(result.ideas).toEqual([]);
    expect(result.buildsFinished).toEqual([]);
  });

  it("doesn't count an idea that became a build a moment later, but does count one started days after", async () => {
    await item({ title: "Straight to build", stage: "building", startedAt: wed + 5_000, createdAt: wed });
    const later = await item({ title: "Idea first", stage: "building", startedAt: wed + 3_600_000, createdAt: wed });
    expect((await week(MONDAY)).ideas.map((entry) => entry.id)).toEqual([later]);
  });

  it("says a quiet week is empty", async () => {
    const result = await week("2026-03-02");
    expect(result).toMatchObject({ empty: true, prints: { total: 0 }, made: [], note: null, grams: null });
  });

  it("knows what is waiting, for the current week only", async () => {
    const monday = mondayOf(Date.now());
    const queued = await item({ title: "Queued idea", stage: "idea", startedAt: null, upNext: 1 });
    const failed = await item({ title: "Stern keeps curling" });
    await attempt(failed, Date.now() - 60_000, { outcome: "failed" });
    const recovered = await item({ title: "Recovered" });
    await attempt(recovered, Date.now() - 120_000, { outcome: "failed" });
    await attempt(recovered, Date.now() - 60_000, { outcome: "success" });
    await env.DB.prepare(
      "INSERT INTO spools (id, material, color_name, remaining, created_by, created_at, updated_at) VALUES (?, 'PLA', 'Sunflower', 'low', ?, ?, ?)",
    )
      .bind(uuid(), alex, Date.now(), Date.now())
      .run();
    const result = await week(monday);
    expect(result.current).toBe(true);
    expect(result.waiting?.upNext).toEqual([{ id: queued, title: "Queued idea" }]);
    expect(result.waiting?.failedLast).toEqual([{ id: failed, title: "Stern keeps curling" }]);
    expect(result.waiting?.low.map((spool) => spool.name)).toEqual(["Sunflower"]);
    // Another week doesn't pretend to know what was waiting then.
    expect((await week("2026-03-02")).waiting).toBeNull();
  });

  it("refuses a day that isn't a Monday, and anyone who isn't signed in", async () => {
    expect((await request("/api/weeks/2026-01-13", { cookie })).status).toBe(400);
    expect((await request("/api/weeks/nonsense", { cookie })).status).toBe(400);
    expect((await request(`/api/weeks/${MONDAY}`)).status).toBe(401);
  });

  it("can be read with a read token", async () => {
    const made = await request("/api/agents", {
      method: "POST",
      cookie,
      json: { name: "A reader", scopes: ["read"] },
    });
    const { token } = await made.json<{ token: string }>();
    const response = await request(`/api/weeks/${MONDAY}`, {
      headers: { Authorization: `Bearer ${token}`, Origin: "http://agent.test" },
    });
    expect(response.status).toBe(200);
  });
});

// ---- Claude's paragraph ----

type Answer = { json?: unknown; stopReason?: string; status?: number };

function stubClaude(answer: Answer | (() => Answer) = { json: { note: "PETG warped twice, both at 70 °C." } }) {
  const bodies: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== "api.anthropic.com") return new Response("nope", { status: 404 });
    bodies.push(String(init?.body));
    const next = typeof answer === "function" ? answer() : answer;
    if (next.status) {
      return Response.json({ type: "error", error: { type: "api_error", message: "no" } }, { status: next.status });
    }
    return Response.json({
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: "claude-opus-5-5",
      content: next.stopReason === "refusal" ? [] : [{ type: "text", text: JSON.stringify(next.json) }],
      stop_reason: next.stopReason ?? "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 },
    });
  });
  return { bodies };
}

const afterTheWeek = at("2026-01-19T08:00:00+01:00");
async function aBusyWeek() {
  const build = await item({ title: "Tugboat" });
  await attempt(build, wed, {
    outcome: "failed",
    failureTags: ["warping"],
    note: "corner lifted",
    settings: { filaments: [{ type: "PETG" }], bedTemperature: 70 },
  });
}
const row = () =>
  env.DB.prepare("SELECT status, text, run_outcome AS runOutcome, tries FROM weeks WHERE monday = ?")
    .bind(MONDAY)
    .first<{ status: string; text: string | null; runOutcome: string | null; tries: number }>();

describe("Claude's paragraph", () => {
  it("is written once for a week that is over, kept, and told what the week held", async () => {
    const { bodies } = stubClaude();
    await aBusyWeek();
    expect(await writeWeekNote(env, MONDAY, { now: afterTheWeek })).toBe("done");
    expect(await row()).toMatchObject({
      status: "done",
      text: "PETG warped twice, both at 70 °C.",
      runOutcome: "done",
    });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain("Tugboat");
    expect(bodies[0]).toContain("corner lifted");
    expect(bodies[0]).toContain("bed 70 °C");
    expect(bodies[0]).toContain("claude-opus-5-5");
    // Once: asking again (the page, the push, the cron) spends nothing.
    expect(await writeWeekNote(env, MONDAY, { now: afterTheWeek + 1000 })).toBe("skipped");
    expect(bodies).toHaveLength(1);
    // And the page shows it.
    const result = await week(MONDAY);
    expect(result.note).toEqual({ status: "done", text: "PETG warped twice, both at 70 °C." });
  });

  it("waits for the week to end (Sunday 19:00 counts), and is only written for last week and this one", async () => {
    const { bodies } = stubClaude();
    await aBusyWeek();
    expect(await writeWeekNote(env, MONDAY, { now: at("2026-01-15T10:00:00+01:00") })).toBe("skipped");
    expect(await writeWeekNote(env, MONDAY, { now: at("2026-01-18T18:59:00+01:00") })).toBe("skipped");
    // Three weeks on: old weeks never spend the key.
    expect(await writeWeekNote(env, MONDAY, { now: at("2026-02-02T10:00:00+01:00") })).toBe("skipped");
    expect(bodies).toHaveLength(0);
    expect(await writeWeekNote(env, MONDAY, { now: at("2026-01-18T19:00:00+01:00") })).toBe("done");
  });

  it("is absent without the key, and for a week with nothing in it", async () => {
    const { bodies } = stubClaude();
    await aBusyWeek();
    const key = env.ANTHROPIC_API_KEY;
    try {
      (env as { ANTHROPIC_API_KEY?: string }).ANTHROPIC_API_KEY = "";
      expect(await writeWeekNote(env, MONDAY, { now: afterTheWeek })).toBe("skipped");
    } finally {
      (env as { ANTHROPIC_API_KEY?: string }).ANTHROPIC_API_KEY = key;
    }
    expect(await row()).toBeNull();
    expect((await week(MONDAY)).note).toBeNull();
    // A quiet week: nothing to read, so Claude isn't asked.
    expect(await writeWeekNote(env, "2026-03-02", { now: at("2026-03-10T10:00:00+01:00") })).toBe("nothing");
    expect(bodies).toHaveLength(0);
  });

  it("says nothing when Claude has nothing to add, and when it refuses or fails", async () => {
    await aBusyWeek();
    stubClaude({ json: { note: null } });
    expect(await writeWeekNote(env, MONDAY, { now: afterTheWeek })).toBe("nothing");
    expect((await week(MONDAY)).note).toBeNull();

    for (const [answer, outcome] of [
      [{ stopReason: "refusal" }, "refusal"],
      [{ status: 500 }, "api_error"],
      [{ json: { wrong: 1 } }, "bad_shape"],
    ] as const) {
      await env.DB.prepare("DELETE FROM weeks").run();
      vi.restoreAllMocks();
      stubClaude(answer);
      expect(await writeWeekNote(env, MONDAY, { now: afterTheWeek })).toBe("failed");
      expect((await row())?.runOutcome).toBe(outcome);
      expect((await week(MONDAY)).note).toBeNull();
    }
  });

  it("counts toward a daily cap (a stand-in server isn't counted)", async () => {
    const { bodies } = stubClaude();
    await aBusyWeek();
    // The cap counts calls made today; fill it with other weeks' rows.
    for (let i = 0; i < WEEK_NOTES_PER_DAY; i++) {
      await env.DB.prepare("INSERT INTO weeks (monday, status, created_at, ran_at) VALUES (?, 'done', ?, ?)")
        .bind(`2020-01-${String(i + 1).padStart(2, "0")}`, afterTheWeek, afterTheWeek)
        .run();
    }
    expect(await writeWeekNote(env, MONDAY, { now: afterTheWeek })).toBe("failed");
    expect((await row())?.runOutcome).toBe("cap");
    expect(bodies).toHaveLength(0);
  });

  it("is claimed when someone opens a finished week, and shown as being written until it lands", async () => {
    stubClaude();
    await aBusyWeek();
    // The route uses the real clock: Monday 2026-11-09 is long over by then, but older than last week it is skipped.
    const monday = mondayOf(Date.now(), "Europe/Stockholm");
    const lastWeek = new Date(Date.parse(`${monday}T12:00:00Z`) - 7 * 86_400_000).toISOString().slice(0, 10);
    const build = await item({ title: "Last week's print" });
    await attempt(build, Date.parse(`${lastWeek}T12:00:00Z`));
    const first = await week(lastWeek);
    expect(first.note?.status).toBe("thinking");
    await vi.waitFor(
      async () => expect((await week(lastWeek)).note).toEqual({ status: "done", text: expect.any(String) }),
      {
        timeout: 5000,
      },
    );
  });
});

// ---- The Sunday push ----

const sundayEvening = at("2026-01-18T19:00:00+01:00");

async function device(userId: string, name: string, extra: { weekNudges?: boolean; timeZone?: string } = {}) {
  await env.DB.prepare(
    `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, time_zone, week_nudges, created_at)
     VALUES (?, ?, ?, 'k', 'a', ?, ?, ?)`,
  )
    .bind(
      uuid(),
      userId,
      `https://push.example/${name}`,
      extra.timeZone ?? "Europe/Stockholm",
      extra.weekNudges === false ? 0 : 1,
      Date.now(),
    )
    .run();
}

describe("the Sunday push", () => {
  let sent: Array<{ endpoint: string; message: PushMessage }>;
  const deliver = async (_env: Env, _vapid: unknown, subscription: { endpoint: string }, message: PushMessage) => {
    sent.push({ endpoint: subscription.endpoint, message });
    return "sent" as const;
  };
  beforeEach(() => {
    sent = [];
    // Claude isn't what is tested here.
    stubClaude({ json: { note: null } });
  });

  it("sends 'Your week' once to each person with it on, and never twice", async () => {
    await aBusyWeek();
    await device(alex, "alex-phone");
    await device(sam, "sam-phone");
    expect(await sendWeekPush(env, sundayEvening, deliver)).toEqual({ sent: 2 });
    expect(sent.map((entry) => entry.endpoint).sort()).toEqual([
      "https://push.example/alex-phone",
      "https://push.example/sam-phone",
    ]);
    expect(sent[0]?.message).toMatchObject({
      kind: "week",
      title: "Your week: 1 print, 1 spaghetti",
      url: "/week/2026-01-12",
      tag: "week-2026-01-12",
    });
    // Every later run of the five-minute cron, until the window closes, leaves it alone.
    expect(await sendWeekPush(env, sundayEvening + 5 * 60_000, deliver)).toEqual({ sent: 0 });
    expect(await sendWeekPush(env, sundayEvening + 2 * 3_600_000, deliver)).toEqual({ sent: 0 });
    expect(sent).toHaveLength(2);
  });

  it("does nothing at any other hour, or on any other day", async () => {
    await aBusyWeek();
    await device(alex, "alex-phone");
    expect(await sendWeekPush(env, at("2026-01-18T18:55:00+01:00"), deliver)).toEqual({ sent: 0 });
    expect(await sendWeekPush(env, at("2026-01-17T19:00:00+01:00"), deliver)).toEqual({ sent: 0 });
    expect(await sendWeekPush(env, at("2026-01-19T19:00:00+01:00"), deliver)).toEqual({ sent: 0 });
    expect(sent).toHaveLength(0);
    // Summer time: 19:00 there is 17:00 UTC.
    await item({ title: "Summer", createdAt: at("2026-07-08T12:00:00+02:00") }).then((id) =>
      attempt(id, at("2026-07-08T12:00:00+02:00")),
    );
    expect(await sendWeekPush(env, at("2026-07-12T19:00:00+02:00"), deliver)).toEqual({ sent: 1 });
  });

  it("respects the switch per device, and the other person's choice", async () => {
    await aBusyWeek();
    await device(alex, "alex-off", { weekNudges: false });
    await device(sam, "sam-phone");
    expect(await sendWeekPush(env, sundayEvening, deliver)).toEqual({ sent: 1 });
    expect(sent.map((entry) => entry.endpoint)).toEqual(["https://push.example/sam-phone"]);
  });

  it("is sent only when the week had a print or an idea", async () => {
    await device(alex, "alex-phone");
    // A comment alone isn't enough, and neither is a quiet week.
    const talk = await item({ createdAt: at("2026-10-01T10:00:00Z") });
    await comment(talk, sam, wed);
    expect(await sendWeekPush(env, sundayEvening, deliver)).toEqual({ sent: 0 });
    await item({ title: "An idea", stage: "idea", startedAt: null, createdAt: wed });
    expect(await sendWeekPush(env, sundayEvening, deliver)).toEqual({ sent: 1 });
    expect(sent[0]?.message.title).toBe("Your week: 1 idea");
  });

  it("lets a failed delivery try again on the next run, then stops", async () => {
    await aBusyWeek();
    await device(alex, "alex-phone");
    expect(await sendWeekPush(env, sundayEvening, async () => "failed")).toEqual({ sent: 0 });
    expect(await sendWeekPush(env, sundayEvening + 5 * 60_000, deliver)).toEqual({ sent: 1 });
    expect(await sendWeekPush(env, sundayEvening + 10 * 60_000, deliver)).toEqual({ sent: 0 });
  });

  it("writes Claude's paragraph first, so the page is complete when it is tapped", async () => {
    vi.restoreAllMocks();
    stubClaude({ json: { note: "A calm week, mostly PLA." } });
    await aBusyWeek();
    await device(alex, "alex-phone");
    await sendWeekPush(env, sundayEvening, deliver);
    expect((await row())?.text).toBe("A calm week, mostly PLA.");
  });
});

describe("the push switch", () => {
  const keys = async () => {
    const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
      "deriveBits",
    ])) as CryptoKeyPair;
    const raw = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
    const b64 = (bytes: Uint8Array) =>
      btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
    return { p256dh: b64(raw), auth: b64(crypto.getRandomValues(new Uint8Array(16))) };
  };

  it("is on for a new device, and can be turned off and on", async () => {
    const endpoint = "https://push.example/new-phone";
    const put = await request("/api/push/subscription", {
      method: "PUT",
      cookie,
      json: { endpoint, keys: await keys(), timeZone: "Europe/Stockholm" },
    });
    expect(put.status).toBe(204);
    const state = async () =>
      ((await (await request("/api/push", { cookie })).json()) as { subscriptions: Array<{ weekNudges: boolean }> })
        .subscriptions[0]?.weekNudges;
    expect(await state()).toBe(true);
    await request("/api/push/subscription", { method: "PATCH", cookie, json: { endpoint, weekNudges: false } });
    expect(await state()).toBe(false);
    await request("/api/push/subscription", { method: "PATCH", cookie, json: { endpoint, weekNudges: true } });
    expect(await state()).toBe(true);
  });
});
