const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Short, calm times for cards and detail: "Just now", "12 min ago",
 * "3 h ago", "Yesterday", "4 days ago", then a date ("12 Oct", "3 Mar 2025").
 */
export function relativeTime(time: number, now = Date.now()): string {
  const diff = Math.max(0, now - time);
  if (diff < MINUTE) return "Just now";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} min ago`;
  const date = new Date(time);
  const today = new Date(now);
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (time >= startOfToday) return `${Math.floor(diff / HOUR)} h ago`;
  const days = Math.ceil((startOfToday - time) / DAY);
  if (days <= 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}),
  });
}

/** relativeTime for the middle of a sentence: "started yesterday", "done 12 Oct". */
export function inlineTime(time: number, now = Date.now()): string {
  const text = relativeTime(time, now);
  return text === "Just now" || text === "Yesterday" ? text.toLowerCase() : text;
}

/** "Saturday 31 October 2026, 18:04", for the detail screen. */
export function fullTime(time: number): string {
  return new Date(time).toLocaleString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
