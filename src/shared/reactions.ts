/**
 * Reactions: a small, curated set of ways to answer an idea or a comment without writing anything. Each person
 * can give each reaction once to the same thing (their own ideas and comments too); giving it again takes it back.
 * Pure, so the client, the Worker and the unit tests share the list and the rules.
 */

/** The curated set, in the order the picker shows it. Labels are what people read and screen readers say. */
export const REACTIONS = [
  { kind: "love", label: "Love it" },
  { kind: "chef", label: "Chef's kiss" },
  { kind: "want", label: "Want one" },
  { kind: "hot", label: "Hot" },
  { kind: "bravo", label: "Bravo" },
  { kind: "melt", label: "Melting" },
] as const;

export type ReactionKind = (typeof REACTIONS)[number]["kind"];

export const REACTION_KINDS = REACTIONS.map((reaction) => reaction.kind) as [ReactionKind, ...ReactionKind[]];

export const isReactionKind = (value: string): value is ReactionKind =>
  (REACTION_KINDS as readonly string[]).includes(value);

export const reactionLabel = (kind: ReactionKind) =>
  REACTIONS.find((reaction) => reaction.kind === kind)?.label ?? kind;

/** One person's reaction. */
export interface Reaction {
  kind: ReactionKind;
  userId: string;
  /** Epoch ms. */
  at: number;
}

/** A reaction as it shows: who gave it (in the order they did) and whether you are one of them. */
export interface ReactionSummary {
  kind: ReactionKind;
  label: string;
  userIds: string[];
  mine: boolean;
}

/** The reactions given, one entry per kind, in the curated order; kinds nobody gave are left out. */
export function summarizeReactions(reactions: readonly Reaction[] | undefined, me: string | undefined) {
  const summaries: ReactionSummary[] = [];
  for (const { kind, label } of REACTIONS) {
    const given = (reactions ?? []).filter((reaction) => reaction.kind === kind).sort((a, b) => a.at - b.at);
    if (!given.length) continue;
    const userIds = [...new Set(given.map((reaction) => reaction.userId))];
    summaries.push({ kind, label, userIds, mine: !!me && userIds.includes(me) });
  }
  return summaries;
}

/** Gives `kind` from `me`, or takes it back if it was already given. */
export function toggleReaction(reactions: readonly Reaction[] | undefined, kind: ReactionKind, me: string, at: number) {
  const list = reactions ?? [];
  const had = list.some((reaction) => reaction.kind === kind && reaction.userId === me);
  return had
    ? list.filter((reaction) => !(reaction.kind === kind && reaction.userId === me))
    : [...list, { kind, userId: me, at }];
}

export const hasReacted = (reactions: readonly Reaction[] | undefined, kind: ReactionKind, me: string | undefined) =>
  !!me && !!reactions?.some((reaction) => reaction.kind === kind && reaction.userId === me);

/** "You", "Sam", "Sam and you": who gave a reaction, for its name and its tooltip. */
export function reactedBy(userIds: readonly string[], me: string | undefined, nameOf: (id: string) => string) {
  const names = userIds.filter((id) => id !== me).map(nameOf);
  if (me && userIds.includes(me)) names.push(names.length ? "you" : "You");
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
