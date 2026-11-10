import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Queue } from "../../bridge/queue.ts";
import { Store } from "../../bridge/store.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bridge-queue-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("the queue on disk", () => {
  it("keeps jobs in order, with their bytes, across a restart", () => {
    const queue = new Queue(dir);
    queue.add({ type: "start", n: 1 }, Uint8Array.from([1, 2, 3]));
    queue.add({ type: "end", n: 2 });
    const again = new Queue(dir);
    const first = again.next();
    expect(first?.job).toMatchObject({ type: "start", n: 1 });
    expect(first && Array.from(again.bytes(first) ?? [])).toEqual([1, 2, 3]);
    if (first) again.done(first);
    expect(again.next()?.job).toMatchObject({ type: "end" });
    expect(again.size).toBe(1);
  });

  it("numbers on from where the last run stopped, so order holds", () => {
    new Queue(dir).add({ type: "a" });
    const later = new Queue(dir);
    later.add({ type: "b" });
    expect(
      readdirSync(dir)
        .filter((file) => file.endsWith(".json"))
        .sort(),
    ).toEqual(["00000001-a.json", "00000002-b.json"]);
  });

  it("replaces waiting jobs of a type, and sets refused ones aside", () => {
    const queue = new Queue(dir);
    queue.add({ type: "ams", v: 1 }, undefined, "ams");
    queue.add({ type: "end" });
    queue.add({ type: "ams", v: 2 }, undefined, "ams");
    expect([queue.next()?.job.type]).toEqual(["end"]);
    const entry = queue.next();
    if (entry) queue.fail(entry);
    expect(queue.next()?.job).toMatchObject({ type: "ams", v: 2 });
    expect(readdirSync(join(dir, "failed"))).toHaveLength(1);
  });
});

describe("the state file", () => {
  it("survives a restart and keeps only the newest attempts", () => {
    const store = new Store(join(dir, "state.json"));
    for (let i = 0; i < 40; i++) store.rememberAttempt(`job:${i}`, { itemId: "i", attemptId: `a${i}` });
    const again = new Store(join(dir, "state.json"));
    expect(Object.keys(again.data.attempts)).toHaveLength(30);
    expect(again.attemptFor("job:39")).toEqual({ itemId: "i", attemptId: "a39" });
    expect(again.attemptFor("job:0")).toBeUndefined();
  });

  it("starts empty from a missing or broken file", () => {
    expect(new Store(join(dir, "nope.json")).data.current).toBeNull();
  });
});
