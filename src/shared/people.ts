/**
 * The colors a person can pick. Each maps to a `--color-person-*` token, so
 * the UI never stores or renders raw color values for people.
 */
export const PERSON_COLORS = ["tomato", "basil", "semolina", "plum", "sea", "clay"] as const;
export type PersonColor = (typeof PERSON_COLORS)[number];

export function isPersonColor(value: string): value is PersonColor {
  return (PERSON_COLORS as readonly string[]).includes(value);
}

/** Usernames are short, lowercase handles used only to sign in. */
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9_-]{1,31}$/;

/**
 * How a person is named in the app: the name they chose, as stored. Carl Oscar
 * and Marie picked first names only, and "Carl Oscar" is one name, so it is
 * never cut at the first space. Initials (client/lib/initials.ts) are separate.
 */
export function displayName(person: { name: string } | null | undefined, fallback = ""): string {
  const name = person?.name.trim();
  return name || fallback;
}

/**
 * Whether the free-text "for …" on an idea or build names this person: their name as stored ("Carl Oscar") or its
 * first word ("Sam" for "Sam Okafor"), in any case. "for Mila" names nobody of the two.
 */
export function namesPerson(forWhom: string | null | undefined, person: { name: string } | null | undefined): boolean {
  const asked = forWhom?.trim().toLowerCase();
  const name = person?.name.trim().toLowerCase();
  if (!asked || !name) return false;
  return asked === name || asked === name.split(/\s+/)[0];
}
