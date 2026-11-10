/** "How did it go?" nudges: what the Worker sends, and the rules for when. Shared so the unit tests and the client's mock read the same text. */
import type { Outcome } from "./attempts.ts";

export type NudgeKind = "off_the_bed" | "overdue";

/** No nudges from 22:00 until 07:00 in the device's time zone. */
export const QUIET_FROM_HOUR = 22;
export const QUIET_TO_HOUR = 7;
/** A print without the bridge is nudged this long after its slicer estimate. */
export const OVERDUE_GRACE_MINUTES = 10;
/** A nudge that has waited this long (a night of quiet hours fits) is dropped: the moment has passed. */
export const NUDGE_WINDOW_HOURS = 12;

export function localHour(timeZone: string, at: number): number {
  const hour = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "numeric", hourCycle: "h23" })
    .formatToParts(at)
    .find((part) => part.type === "hour")?.value;
  return Number(hour);
}

export function isQuietHour(timeZone: string, at: number): boolean {
  const hour = localHour(timeZone, at);
  return hour >= QUIET_FROM_HOUR || hour < QUIET_TO_HOUR;
}

/** Whether a time zone name is one Intl knows. */
export function isTimeZone(name: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

export interface NudgeCandidate {
  outcome: Outcome | null;
  printedAt: number;
  /** When the bridge saw it come off the bed. */
  endedAt: number | null;
  /** The slicer's estimate, in minutes. */
  estimatedMinutes?: number;
}

/**
 * Which nudge an attempt is due, if any: "off the bed" (the bridge said so) wins over "overdue" (the
 * slicer's estimate plus ten minutes has passed). Nothing once it has an outcome or the moment has passed.
 */
export function dueNudge(attempt: NudgeCandidate, now: number): { kind: NudgeKind; since: number } | null {
  if (attempt.outcome) return null;
  const windowMs = NUDGE_WINDOW_HOURS * 60 * 60 * 1000;
  if (attempt.endedAt !== null) {
    return attempt.endedAt <= now && now - attempt.endedAt <= windowMs
      ? { kind: "off_the_bed", since: attempt.endedAt }
      : null;
  }
  if (!attempt.estimatedMinutes || attempt.estimatedMinutes <= 0) return null;
  const due = attempt.printedAt + (attempt.estimatedMinutes + OVERDUE_GRACE_MINUTES) * 60_000;
  return due <= now && now - due <= windowMs ? { kind: "overdue", since: due } : null;
}

export const NUDGE_ACTIONS: Array<{ action: Outcome; title: string }> = [
  { action: "success", title: "Worked" },
  { action: "partial", title: "Partly" },
  { action: "failed", title: "Spaghetti" },
];

/** Where a notification is shown, which decides how many answer buttons it can have. */
export type NotificationPlatform = "ios" | "android" | "desktop";

/** iPhone has no buttons, Android three, desktop Chrome two (the first and last: Partly is one tap away in the sheet). */
export function actionsFor(platform: NotificationPlatform): typeof NUDGE_ACTIONS {
  if (platform === "ios") return [];
  if (platform === "desktop") return [NUDGE_ACTIONS[0], NUDGE_ACTIONS[2]].filter((a) => a !== undefined);
  return NUDGE_ACTIONS;
}

/** The line under the preview: only what is true on this device. */
export function answerHint(platform: NotificationPlatform): string {
  if (platform === "ios") return "Tap the notification to answer, and add a photo while you're there.";
  if (platform === "desktop")
    return "Worked or Spaghetti; Partly is in the sheet. Tap the notification to add a photo and a word.";
  return "On your lock screen, tap Worked, Partly or Spaghetti to answer without opening the app, or tap the notification to add a photo and a word.";
}

/** What the service worker shows. `url` opens the attempt sheet; `actions` are for platforms that have buttons. */
export interface PushMessage {
  kind: NudgeKind | "test";
  title: string;
  body: string;
  /** Replaces an earlier notification for the same thing. */
  tag: string;
  url: string;
  attemptId?: string;
  itemId?: string;
  actions: Array<{ action: string; title: string }>;
}

export const attemptUrl = (itemId: string, attemptId: string) =>
  `/builds/${itemId}?attempt=${encodeURIComponent(attemptId)}&finish=1`;

/** `owner` is the other person's name when the print isn't the recipient's own. */
export function nudgeMessage(
  kind: NudgeKind,
  attempt: { id: string; itemId: string },
  itemTitle: string,
  owner?: string,
): PushMessage {
  const name = itemTitle.trim() || "A print";
  return {
    kind,
    title: kind === "off_the_bed" ? `${name} is off the bed` : `${name} should be done by now`,
    body: owner ? `${owner}'s print. How did it go?` : "How did it go?",
    tag: `attempt-${attempt.id}`,
    url: attemptUrl(attempt.itemId, attempt.id),
    attemptId: attempt.id,
    itemId: attempt.itemId,
    actions: NUDGE_ACTIONS,
  };
}

export const testMessage: PushMessage = {
  kind: "test",
  title: "Spaghetti can reach you here",
  body: "This is what “how did it go?” will look like.",
  tag: "test",
  url: "/ideas",
  actions: [],
};

/** What this device tells the server about itself: its subscription, its time zone and the setting. */
export interface PushSubscriptionBody {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  timeZone: string;
  alsoOthers?: boolean;
}

export interface PushConfig {
  /** Null when the server has no VAPID key: the settings row isn't shown. */
  publicKey: string | null;
  /** False when the private half is missing (a local server): subscribing works, sending doesn't. */
  canSend: boolean;
  /** This person's devices. */
  subscriptions: Array<{ endpoint: string; alsoOthers: boolean; timeZone: string }>;
}
