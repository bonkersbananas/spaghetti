/**
 * The sentences of the week page's lines that name a person, written for whoever reads: the signed-in person is
 * "you" (and the verb follows), the other keeps their name.
 */
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const firstName = (full: string) => full.split(" ")[0] ?? full;

/** One person in a sentence: `me` when they are the reader (`You`, `you`), else their first name. */
export interface Who {
  id: string;
  /** Full name, when it is known. */
  name?: string;
}

const called = (who: Who, me: string | undefined, start: boolean) =>
  who.id === me ? (start ? "You" : "you") : firstName(who.name ?? "Someone");

/** "You captured 3 ideas", "Sam captured 3 ideas", "You captured 2 ideas and Sam 1", "Sam captured 2 ideas and you 1". */
export function ideasLine(by: Array<{ who: Who; count: number }>, me: string | undefined): string {
  const [first, second] = by;
  if (!first) return "";
  const lead = `${called(first.who, me, true)} captured ${plural(first.count, "idea")}`;
  return second ? `${lead} and ${called(second.who, me, false)} ${second.count}` : lead;
}

/** "You two exchanged 4 comments", "You left 2 comments", "Sam left 1 comment". */
export function commentsLine(total: number, talkers: Who[], me: string | undefined): string {
  const count = plural(total, "comment");
  const [only] = talkers;
  if (talkers.length > 1) return `You two exchanged ${count}`;
  return `${only ? called(only, me, true) : "Someone"} left ${count}`;
}
