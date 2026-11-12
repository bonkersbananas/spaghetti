/**
 * Reactions: any emoji, a way to answer an idea or a comment without writing anything (decision 0042). Each person
 * can give each emoji once to the same thing (their own ideas and comments too); giving it again takes it back.
 * Pure, so the client, the Worker and the unit tests share the rules. A reaction's `kind` is the emoji itself.
 */

/** What the quick row holds until the two of you have a history: close to the six that came first. */
export const DEFAULT_QUICK_EMOJI = ["❤️", "🤌", "🤩", "🔥", "👏", "🫠"] as const;

/** How many emoji the quick row shows. */
export const QUICK_EMOJI_COUNT = 6;

/** The longest a reaction may be, in UTF-16 units: a family of four with skin tones is 25, a flag 14. */
export const MAX_EMOJI_LENGTH = 40;

/** One emoji that Unicode recommends for general interchange (RGI), flags and ZWJ sequences included. */
const UNICODE_SETS = ["v"].join("");
// Built from a string: the `v` flag is newer than the TypeScript target, and workerd and every browser here take it.
// biome-ignore lint/complexity/useRegexLiterals: a literal with the `v` flag doesn't compile for the TypeScript target
const RGI_EMOJI = new RegExp("^\\p{RGI_Emoji}$", UNICODE_SETS);

/** Whether `value` is exactly one RGI emoji: no text, no spaces, no second emoji. */
export const isEmoji = (value: string): boolean => value.length <= MAX_EMOJI_LENGTH && RGI_EMOJI.test(value);

/** The six reactions before decision 0042, and the emoji they became (the migration maps the same way). */
export const LEGACY_REACTIONS: Record<string, string> = {
  love: "❤️",
  chef: "🤌",
  want: "🤩",
  hot: "🔥",
  bravo: "👏",
  melt: "🫠",
};

/** One person's reaction. */
export interface Reaction {
  /** The emoji. */
  kind: string;
  userId: string;
  /** Epoch ms. */
  at: number;
}

/** A reaction as it shows: who gave it (in the order they did) and whether you are one of them. */
export interface ReactionSummary {
  emoji: string;
  userIds: string[];
  mine: boolean;
}

/** The reactions given, one entry per emoji, in the order each was first given. */
export function summarizeReactions(reactions: readonly Reaction[] | undefined, me: string | undefined) {
  const byEmoji = new Map<string, Reaction[]>();
  for (const reaction of [...(reactions ?? [])].sort((a, b) => a.at - b.at)) {
    const list = byEmoji.get(reaction.kind);
    if (list) list.push(reaction);
    else byEmoji.set(reaction.kind, [reaction]);
  }
  const summaries: ReactionSummary[] = [];
  for (const [emoji, given] of byEmoji) {
    const userIds = [...new Set(given.map((reaction) => reaction.userId))];
    summaries.push({ emoji, userIds, mine: !!me && userIds.includes(me) });
  }
  return summaries;
}

/** Gives `emoji` from `me`, or takes it back if it was already given. */
export function toggleReaction(reactions: readonly Reaction[] | undefined, emoji: string, me: string, at: number) {
  const list = reactions ?? [];
  const had = list.some((reaction) => reaction.kind === emoji && reaction.userId === me);
  return had
    ? list.filter((reaction) => !(reaction.kind === emoji && reaction.userId === me))
    : [...list, { kind: emoji, userId: me, at }];
}

export const hasReacted = (reactions: readonly Reaction[] | undefined, emoji: string, me: string | undefined) =>
  !!me && !!reactions?.some((reaction) => reaction.kind === emoji && reaction.userId === me);

/** "You", "Sam", "Sam and you": who gave a reaction, for its name and its tooltip. */
export function reactedBy(userIds: readonly string[], me: string | undefined, nameOf: (id: string) => string) {
  const names = userIds.filter((id) => id !== me).map(nameOf);
  if (me && userIds.includes(me)) names.push(names.length ? "you" : "You");
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** What GET /api/reactions/used answers: the emoji the two of you give most, and the ones you gave last. */
export interface EmojiUse {
  /** Most used first (ties: the more recent). */
  popular: string[];
  /** Your own latest, newest first, each once. */
  recent: string[];
}

/** The quick row: the most used, filled up with the defaults that aren't in it yet. */
export function quickEmoji(popular: readonly string[] | undefined): string[] {
  const row = (popular ?? []).slice(0, QUICK_EMOJI_COUNT);
  for (const emoji of DEFAULT_QUICK_EMOJI) {
    if (row.length >= QUICK_EMOJI_COUNT) break;
    if (!row.includes(emoji)) row.push(emoji);
  }
  return row;
}
