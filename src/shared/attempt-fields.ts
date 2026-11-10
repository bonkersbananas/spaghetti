/**
 * An attempt as the fields of the attempt sheet, one by one, so the sheet can
 * follow the server a field at a time (a note typed here stays while the
 * other person's tag appears; a setting changed there arrives while this one
 * is being edited) and send only what changed here. The settings are one JSON
 * value on the server, so each setting becomes its own field (`s.bedTemperature`)
 * and goes back merged into the server's latest settings.
 */
import type { AttemptSettings, Outcome, SettingKey } from "./attempts.ts";
import { SETTING_KEYS } from "./attempts.ts";

type SettingFields = { [K in SettingKey as `s.${K}`]?: AttemptSettings[K] };

export type SheetFields = {
  outcome: Outcome | null;
  printedAt: number;
  note: string;
  failureTags: string[];
  successNotes: string[];
} & SettingFields;

/** The parts of an attempt the sheet edits. */
export interface EditableAttempt {
  outcome: Outcome | null;
  printedAt: number;
  note: string;
  failureTags: string[];
  successNotes: string[];
  settings: AttemptSettings;
}

/** What the sheet edits, whole: the form's value in the shape the rest of the sheet uses. */
export type SheetValue = EditableAttempt;

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/** The fields of an attempt: every setting has its own key, undefined when the attempt says nothing about it. */
export function toFields(attempt: EditableAttempt): SheetFields {
  const fields: Record<string, unknown> = {
    outcome: attempt.outcome,
    printedAt: attempt.printedAt,
    note: attempt.note,
    failureTags: attempt.failureTags,
    successNotes: attempt.successNotes,
  };
  for (const key of SETTING_KEYS) fields[`s.${key}`] = attempt.settings[key];
  return fields as SheetFields;
}

/** The sheet's value from its fields. */
export function toValue(fields: SheetFields): SheetValue {
  const settings: Record<string, unknown> = {};
  for (const key of SETTING_KEYS) {
    const value = fields[`s.${key}`];
    if (value !== undefined) settings[key] = value;
  }
  return {
    outcome: fields.outcome,
    printedAt: fields.printedAt,
    note: fields.note,
    failureTags: fields.failureTags,
    successNotes: fields.successNotes,
    settings: settings as AttemptSettings,
  };
}

/** The change to fields that a change to the sheet's value makes: only the settings that differ become fields. */
export function fieldsFor(current: SheetFields, next: Partial<SheetValue>): Partial<SheetFields> {
  const { settings, ...rest } = next;
  const patch: Record<string, unknown> = { ...rest };
  if (settings) {
    for (const key of SETTING_KEYS) {
      if (!same(settings[key], current[`s.${key}`])) patch[`s.${key}`] = settings[key];
    }
  }
  return patch as Partial<SheetFields>;
}

/** A change to some settings only: these set, these removed, the rest left as the server has them. */
export interface SettingsMerge {
  set: AttemptSettings;
  unset: SettingKey[];
}

/**
 * What changed fields come to: the plain ones as they are; for settings, the
 * attempt's settings as this screen knows them with those applied (`settings`,
 * for the cache and for an attempt the server doesn't have yet) and just the
 * settings that changed (`settingsMerge`, what is sent to the server, which
 * applies them to its own latest settings, so a setting the other person
 * changed meanwhile is not put back as it was).
 */
export function toChanges(
  changes: Partial<SheetFields>,
  knownSettings: AttemptSettings,
): { changes: Partial<Omit<SheetValue, "settings">> & { settings?: AttemptSettings }; settingsMerge?: SettingsMerge } {
  const out: Record<string, unknown> = {};
  let whole: Record<string, unknown> | undefined;
  const merge: { set: Record<string, unknown>; unset: SettingKey[] } = { set: {}, unset: [] };
  for (const [key, value] of Object.entries(changes)) {
    if (!key.startsWith("s.")) {
      out[key] = value;
      continue;
    }
    const name = key.slice(2) as SettingKey;
    whole ??= { ...knownSettings };
    if (value === undefined) {
      delete whole[name];
      merge.unset.push(name);
    } else {
      whole[name] = value;
      merge.set[name] = value;
    }
  }
  if (whole) out.settings = whole;
  return {
    changes: out,
    ...(whole ? { settingsMerge: { set: merge.set as AttemptSettings, unset: merge.unset } } : {}),
  };
}
