import type { Person } from "@shared/api";
import type { Change, ChangesResponse } from "@shared/changes";
import { displayName } from "@shared/people";
import type { QueryClient } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useEffect, useSyncExternalStore } from "react";
import { toast } from "@/components/ui/Toast";
import { agentsQuery } from "./agents";
import { api } from "./api";
import { isOnline, subscribeConnection } from "./connection";
import { itemKeys } from "./items";
import { peopleQuery, sessionQuery } from "./queries";

/**
 * Live updates between the two people. The Worker records every write in a
 * change feed (`GET /api/changes?after=<cursor>`, see shared/changes.ts); while
 * the app is visible and online this asks for what is new every POLL_MS, and at
 * once on focus, on coming back to the tab and when the connection returns,
 * then refreshes only the queries those changes touch.
 *
 * Polling, not a socket: for two people a "nothing new" answer is one indexed
 * read, it works the same on Workers and in the local container, and a hidden
 * or offline tab simply stops asking and catches up when it returns.
 */
export const POLL_MS = 10_000;
/** How long something the other person made counts as "just arrived" (it lands with the capture bounce when it mounts). */
const ARRIVED_MS = 6000;

/** What the feed needs from the app: where the person is looking. */
export interface LiveScreen {
  /** The current path, e.g. "/ideas/3f2a…". */
  pathname: () => string;
  /** Closes the screen of something that was deleted: back to the list it came from. */
  leave: (to: string) => void;
}

// --- who just arrived -----------------------------------------------------------------------------

let arrived: ReadonlySet<string> = new Set();
const arrivedListeners = new Set<() => void>();

function markArrived(ids: string[]) {
  if (!ids.length) return;
  arrived = new Set([...arrived, ...ids]);
  for (const listener of arrivedListeners) listener();
  setTimeout(() => {
    const next = new Set(arrived);
    for (const id of ids) next.delete(id);
    arrived = next;
    for (const listener of arrivedListeners) listener();
  }, ARRIVED_MS);
}

/** Ids of items the other person just made (or made a build): their cards land with the little bounce. */
export function useArrived(): ReadonlySet<string> {
  return useSyncExternalStore(
    (listener) => {
      arrivedListeners.add(listener);
      return () => arrivedListeners.delete(listener);
    },
    () => arrived,
    () => arrived,
  );
}

// --- which queries a change touches ---------------------------------------------------------------

/** Marks the queries these changes touch as stale; the ones on screen refetch at once, the rest when next opened. */
export function refresh(queryClient: QueryClient, changes: Change[]) {
  const roots = new Set<string>();
  const details = new Set<string>();
  let lists = false;
  for (const change of changes) {
    switch (change.entity) {
      case "item":
      case "attempt":
        lists = true;
        roots.add("journal").add("insights").add("facets").add("search").add("what-worked").add("spools");
        break;
      case "photo":
      case "file":
        lists = true;
        break;
      case "spool":
      case "slot":
      case "printer":
        roots.add("spools").add("printer").add("upkeep");
        break;
      case "comment":
        roots.add("comments");
        break;
      case "recipe":
        roots.add("recipes").add("search").add("what-worked");
        break;
      case "shopping":
        roots.add("shopping");
        break;
      case "tag":
        roots.add("tags");
        break;
      case "agent":
        roots.add("agents");
        break;
      case "person":
        roots.add("people").add("session");
        break;
      case "signin":
        roots.add("sign-in-links").add("devices");
        break;
      case "invite":
        roots.add("invites");
        break;
      case "passkey":
        roots.add("passkeys");
        break;
    }
    // A comment shows in its thread and on cards, not in the item itself.
    if (change.itemId && change.entity !== "spool" && change.entity !== "comment") details.add(change.itemId);
  }
  if (lists) void queryClient.invalidateQueries({ queryKey: [itemKeys.all[0], "list"] });
  for (const id of details) void queryClient.invalidateQueries({ queryKey: itemKeys.detail(id) });
  for (const root of roots) void queryClient.invalidateQueries({ queryKey: [root] });
}

/** Everything the feed could have changed, when it can't say what did. */
function refreshAll(queryClient: QueryClient) {
  // People and the session too: a profile picture is a change in the feed.
  void queryClient.invalidateQueries();
}

// --- the quiet word -------------------------------------------------------------------------------

const nameOf = (person?: Person) => displayName(person, "Someone");
const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

/** The item or spool whose screen is open, from the path. */
function openScreen(pathname: string) {
  const match = /^\/(ideas|builds|pantry)\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  return { kind: match[1] as "ideas" | "builds" | "pantry", id: decodeURIComponent(match[2] ?? "") };
}

/**
 * What happened to the very thing on screen, said once and gently: a photo or
 * an attempt from the other person, or it being deleted, in which case the
 * screen closes. Everything else just updates in place.
 */
function sayAboutScreen(queryClient: QueryClient, screen: LiveScreen, changes: Change[]) {
  const open = openScreen(screen.pathname());
  if (!open) return;
  const me = queryClient.getQueryData(sessionQuery.queryKey)?.id;
  const people = queryClient.getQueryData(peopleQuery.queryKey);
  const who = (change: Change) =>
    change.actor.id === me ? "You" : nameOf(people?.find((person) => person.id === change.actor.id));
  const mine = (change: Change) => change.actor.kind === "person" && change.actor.id === me;
  const agents = queryClient.getQueryData(agentsQuery.queryKey);
  // "Sam logged an attempt", or for an agent, quietly: "Logged an attempt via Claude for Alex".
  const said = (change: Change, did: string) => {
    if (change.actor.kind !== "agent") return `${who(change)} ${did}`;
    const name = agents?.find((agent) => agent.id === change.actor.id)?.name;
    return name ? `${did.charAt(0).toUpperCase()}${did.slice(1)} via ${name}` : `An agent ${did}`;
  };

  if (open.kind === "pantry") {
    const gone = changes.findLast((c) => c.entity === "spool" && c.id === open.id && c.action === "deleted");
    if (gone) {
      screen.leave("/pantry");
      toast.message(
        mine(gone) ? "That spool was removed on another device" : `${who(gone)} took that spool off the shelf`,
      );
    }
    return;
  }

  const here = changes.filter((change) => change.itemId === open.id);
  const noun = open.kind === "ideas" ? "idea" : "build";
  // Deleted (and not brought back by an undo since): the screen closes with a quiet word.
  const lastMove = here.findLast(
    (change) => change.entity === "item" && (change.action === "deleted" || change.action === "restored"),
  );
  if (lastMove?.action === "deleted") {
    screen.leave(open.kind === "ideas" ? "/ideas" : "/builds");
    toast.message(
      mine(lastMove) ? `This ${noun} was deleted on another device` : `${who(lastMove)} deleted this ${noun}`,
    );
    return;
  }
  // The other person's work on this item; what you did yourself you already saw.
  const theirs = here.filter((change) => !mine(change));
  const photos = theirs.filter((change) => change.entity === "photo" && change.action === "created");
  const attempt = theirs.findLast((change) => change.entity === "attempt" && change.action === "created");
  const removed = theirs.findLast((change) => change.entity === "attempt" && change.action === "deleted");
  if (attempt) toast.message(said(attempt, "logged an attempt"));
  else if (photos.length) {
    const first = photos[0];
    if (first) toast.message(said(first, `added ${plural(photos.length, "a photo", `${photos.length} photos`)}`));
  } else if (removed) toast.message(said(removed, "deleted an attempt"));
}

/** New things from the other person land with a little bounce when their card mounts. */
function noteArrivals(queryClient: QueryClient, changes: Change[]) {
  const me = queryClient.getQueryData(sessionQuery.queryKey)?.id;
  const ids = changes
    .filter(
      (change) =>
        change.actor.id !== me &&
        change.itemId &&
        ((change.entity === "item" && (change.action === "created" || change.action === "restored")) ||
          (change.entity === "attempt" && change.action === "created")),
    )
    .map((change) => change.itemId as string);
  markArrived([...new Set(ids)]);
}

// --- the loop -------------------------------------------------------------------------------------

/** Applies one answer of the feed. Exported for tests. */
export function applyChanges(queryClient: QueryClient, screen: LiveScreen, response: ChangesResponse) {
  if (response.reset) return refreshAll(queryClient);
  if (!response.changes.length) return;
  noteArrivals(queryClient, response.changes);
  refresh(queryClient, response.changes);
  sayAboutScreen(queryClient, screen, response.changes);
}

/**
 * Starts following the feed; returns the cleanup. The first answer only
 * learns where the feed ends: what the screens loaded is already current.
 */
export function followChanges(queryClient: QueryClient, screen: LiveScreen) {
  let cursor: number | null = null;
  let running: Promise<void> | null = null;
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  const visible = () => document.visibilityState !== "hidden";

  async function once() {
    for (;;) {
      const response = await api<ChangesResponse>(cursor === null ? "/changes" : `/changes?after=${cursor}`);
      if (stopped) return;
      const first = cursor === null;
      cursor = response.cursor;
      if (!first) applyChanges(queryClient, screen, response);
      if (!response.more) return;
    }
  }

  /** Asks now, unless hidden, offline or already asking. A failed ask is just tried again later. */
  function poll() {
    if (stopped || running || !visible() || !isOnline()) return;
    running = once()
      .catch(() => undefined)
      .finally(() => {
        running = null;
      });
  }

  function start() {
    clearInterval(timer);
    timer = undefined;
    if (!visible()) return;
    timer = setInterval(poll, POLL_MS);
    poll();
  }

  const onVisibility = () => start();
  const onFocus = () => poll();
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("focus", onFocus);
  // Back online: catch up at once.
  let wasOnline = isOnline();
  const unsubscribe = subscribeConnection(() => {
    const now = isOnline();
    if (now && !wasOnline) poll();
    wasOnline = now;
  });
  start();

  return () => {
    stopped = true;
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("focus", onFocus);
    unsubscribe();
  };
}

/** Follows the change feed while the signed-in app is open. */
export function useLiveUpdates() {
  const queryClient = useQueryClient();
  const router = useRouter();
  useEffect(
    () =>
      followChanges(queryClient, {
        pathname: () => router.state.location.pathname,
        leave: (to) => void router.navigate({ to, replace: true }),
      }),
    [queryClient, router],
  );
}
