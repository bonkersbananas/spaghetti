import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { subscribeToSeen } from "../../src/client/lib/seen-store.ts";

const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));

/** Many cards each subscribing an observer, as a grid of ideas does in one React commit. */
function mountCards(client: QueryClient, count: number, key: readonly unknown[]) {
  const stops: Array<() => void> = [];
  for (let index = 0; index < count; index++) {
    const observer = new QueryObserver(client, {
      queryKey: key,
      queryFn: () => ({ threads: [] }),
      select: (data: { threads: unknown[] }) => data.threads.length,
      enabled: false,
    });
    stops.push(observer.subscribe(() => undefined));
    observer.updateResult();
  }
  return () => {
    for (const stop of stops) stop();
  };
}

describe("subscribeToSeen (useLastSeen's subscription, #60)", () => {
  it("never calls back inside the work that caused it, and calls back once for many events", async () => {
    const client = new QueryClient();
    let calls = 0;
    const seen = subscribeToSeen(client.getQueryCache(), ["items"], () => calls++);
    client.setQueryData(["items", "ideas"], [{ id: "a" }]);
    const unmount = mountCards(client, 80, ["items", "ideas"]);
    // A synchronous call here is what forced a nested React update per card.
    expect(calls).toBe(0);
    await tick();
    expect(calls).toBe(1);
    unmount();
    seen.unsubscribe();
  });

  it("ignores queries it doesn't read and an observer's own result updates", async () => {
    const client = new QueryClient();
    let calls = 0;
    const seen = subscribeToSeen(client.getQueryCache(), ["items"], () => calls++);
    // The unread-comments marker every idea card reads: not a watched root.
    const unmount = mountCards(client, 80, ["comments", "unread"]);
    client.setQueryData(["comments", "unread"], { threads: [] });
    await tick();
    expect(calls).toBe(0);
    unmount();
    seen.unsubscribe();
  });

  it("goes quiet once unsubscribed, even with a call already scheduled", async () => {
    const client = new QueryClient();
    let calls = 0;
    const seen = subscribeToSeen(client.getQueryCache(), ["items"], () => calls++);
    client.setQueryData(["items", "builds"], []);
    seen.unsubscribe();
    await tick();
    client.setQueryData(["items", "builds"], [{ id: "b" }]);
    await tick();
    expect(calls).toBe(0);
  });
});
