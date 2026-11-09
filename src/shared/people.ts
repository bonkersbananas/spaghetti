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
