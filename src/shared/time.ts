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

/** 130 → "2 h 10 min". */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  if (!hours) return `${rest} min`;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

/** How long ago something was, in whole days, for a spool's "dried 12 d ago": "today", "1 d ago", "12 d ago". */
export function daysAgo(time: number, now = Date.now()): string {
  const days = Math.floor(Math.max(0, now - time) / DAY);
  return days === 0 ? "today" : `${days} d ago`;
}

/**
 * How long ago, in words that stay readable for old things: "3 days ago", "5 weeks ago", "4 months ago".
 * Under a week it is relativeTime; Today's "On the back burner" uses it for ideas weeks old.
 */
export function ageWords(time: number, now = Date.now()): string {
  const days = Math.floor(Math.max(0, now - time) / DAY);
  if (days < 7) return relativeTime(time, now);
  if (days < 60) {
    const weeks = Math.floor(days / 7);
    return `${weeks} ${weeks === 1 ? "week" : "weeks"} ago`;
  }
  const months = Math.floor(days / 30);
  return months < 12 ? `${months} months ago` : `${Math.floor(months / 12)} ${months < 24 ? "year" : "years"} ago`;
}
