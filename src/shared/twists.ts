/**
 * Twists: another person's model, changed our way (decision 0043). A twist keeps where the model came from, what we
 * changed (in words and as values) and, later, our file and the builds that printed it. Pure rules shared by the
 * Worker and the app.
 */

export const TWIST_NAME_MAX = 120;
export const TWIST_NOTE_MAX = 2000;
export const TWIST_CHANGES_MAX = 20;
export const TWIST_VALUE_MAX = 80;
export const TWIST_CHANGE_NOTE_MAX = 200;

/** The kinds of change a twist can list. "other" is words only: a change is worth keeping even when nothing can apply it. */
export const CHANGE_KINDS = ["scale", "tolerance", "text", "material", "param", "other"] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

/** In the words the app shows. */
export const CHANGE_LABELS: Record<ChangeKind, string> = {
  scale: "Scale",
  tolerance: "Fit tolerance",
  text: "Text",
  material: "Material",
  param: "Setting",
  other: "Other",
};

/** One thing we changed: "Scale · 84 %" with "fits the 42 mm grid". */
export interface TwistChange {
  /** Picked by whoever writes it, so a list edit keeps each row's identity. */
  id: string;
  kind: ChangeKind;
  /** What a "setting" or "other" change is called ("Wall count"); the kind's own name otherwise. */
  label: string;
  /** "84 %", "+0.2 mm", "Marie", "PETG". May be empty for words-only changes. */
  value: string;
  note: string;
}

/** The name a change is shown by. */
export const changeName = (change: Pick<TwistChange, "kind" | "label">) =>
  change.label.trim() || CHANGE_LABELS[change.kind];

/** "Scale 84 %": a change in a chip. */
export const changeChip = (change: TwistChange) => [changeName(change), change.value.trim()].filter(Boolean).join(" ");

/** Where the model came from. All of it optional: a twist can start from nothing but a name. */
export interface TwistSourceFields {
  url: string | null;
  /** The model's own name, as its page or file calls it. */
  title: string | null;
  designer: string | null;
  license: string | null;
}
