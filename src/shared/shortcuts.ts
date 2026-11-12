/**
 * Every keyboard shortcut in the app, defined once. The screens bind handlers
 * to these ids (`useHotkeys({ capture: … })`), the hotkey listener reads the
 * keys from here, and the `?` overlay lists them, so what the list says and
 * what the keys do cannot drift apart.
 *
 * A key is written the way `comboOf` reports it: lowercase `KeyboardEvent.key`
 * ("c", "/", "?", "arrowdown", "escape"), two keys pressed one after the other
 * separated by a space ("g i"), and `mod+` in front for ⌘ on a Mac and Ctrl
 * elsewhere ("mod+k").
 */

/** Where a shortcut works. The overlay groups by it. */
export const SHORTCUT_GROUPS = [
  "anywhere",
  "palette",
  "lists",
  "idea",
  "build",
  "attempt",
  "journal",
  "week",
  "search",
  "pantry",
  "spool",
  "shopping",
] as const;
export type ShortcutGroup = (typeof SHORTCUT_GROUPS)[number];

export const GROUP_LABELS: Record<ShortcutGroup, string> = {
  anywhere: "Anywhere",
  palette: "In the command palette",
  lists: "In lists",
  idea: "On an idea",
  build: "On a build",
  attempt: "In the attempt sheet",
  journal: "In the journal",
  week: "On a week",
  search: "In search",
  pantry: "In the pantry",
  spool: "On a spool",
  shopping: "On the shopping list",
};

/** How the overlay lays the groups out in three columns of about the same height. */
export const SHORTCUT_COLUMNS: readonly (readonly ShortcutGroup[])[] = [
  ["anywhere", "search", "week", "pantry"],
  ["build", "attempt", "journal"],
  ["lists", "idea", "spool", "shopping", "palette"],
];

interface ShortcutDefinition {
  id: string;
  group: ShortcutGroup;
  /** What it does, as a short phrase. */
  label: string;
  /** Alternatives that do the same thing; the first is the one shown first. */
  keys: readonly string[];
}

const define = <const T extends readonly ShortcutDefinition[]>(list: T) => list;

export const SHORTCUTS = define([
  { id: "palette", group: "anywhere", label: "Open the command palette", keys: ["mod+k"] },
  { id: "help", group: "anywhere", label: "Show the shortcuts", keys: ["?"] },
  { id: "capture", group: "anywhere", label: "New idea", keys: ["c"] },
  { id: "goToday", group: "anywhere", label: "Go to Today", keys: ["g t"] },
  { id: "goIdeas", group: "anywhere", label: "Go to Ideas", keys: ["g i"] },
  { id: "goWishlist", group: "anywhere", label: "Go to Wishlists", keys: ["g w"] },
  { id: "goBuilds", group: "anywhere", label: "Go to Builds", keys: ["g b"] },
  { id: "goJournal", group: "anywhere", label: "Go to Journal", keys: ["g j"] },
  { id: "search", group: "anywhere", label: "Search", keys: ["/"] },
  { id: "goPantry", group: "anywhere", label: "Go to the Pantry", keys: ["g p"] },
  { id: "goPrinter", group: "anywhere", label: "Go to the Printer", keys: ["g r"] },
  { id: "goShopping", group: "anywhere", label: "Go to the shopping list", keys: ["g s"] },

  { id: "paletteNext", group: "palette", label: "Next result", keys: ["arrowdown"] },
  { id: "palettePrevious", group: "palette", label: "Previous result", keys: ["arrowup"] },
  { id: "paletteRun", group: "palette", label: "Open it, or run it", keys: ["enter"] },
  { id: "paletteClose", group: "palette", label: "Close", keys: ["escape"] },

  { id: "listNext", group: "lists", label: "Next card", keys: ["j"] },
  { id: "listPrevious", group: "lists", label: "Previous card", keys: ["k"] },

  { id: "ideaBack", group: "idea", label: "Back to Ideas", keys: ["escape"] },
  { id: "ideaBuild", group: "idea", label: "Start building", keys: ["b"] },
  { id: "ideaMove", group: "idea", label: "Add to a build", keys: ["a"] },
  { id: "ideaPhotoPrevious", group: "idea", label: "Previous photo", keys: ["arrowleft"] },
  { id: "ideaPhotoNext", group: "idea", label: "Next photo", keys: ["arrowright"] },
  { id: "ideaComment", group: "idea", label: "Say something to the other person", keys: ["m"] },
  { id: "ideaDelete", group: "idea", label: "Delete, with undo", keys: ["backspace", "delete"] },

  { id: "buildBack", group: "build", label: "Back to Builds, or let go of the attempt", keys: ["escape"] },
  { id: "buildLog", group: "build", label: "Log or finish an attempt", keys: ["a"] },
  { id: "buildNext", group: "build", label: "Next attempt", keys: ["j", "arrowdown"] },
  { id: "buildPrevious", group: "build", label: "Previous attempt", keys: ["k", "arrowup"] },
  { id: "buildComment", group: "build", label: "Say something to the other person", keys: ["m"] },
  { id: "buildCompare", group: "build", label: "Compare with the attempt before", keys: ["v"] },
  { id: "buildOpen", group: "build", label: "Open the picked attempt", keys: ["enter"] },
  { id: "buildPhotoPrevious", group: "build", label: "Previous photo", keys: ["arrowleft"] },
  { id: "buildPhotoNext", group: "build", label: "Next photo", keys: ["arrowright"] },
  {
    id: "buildDelete",
    group: "build",
    label: "Delete the attempt, or the build",
    keys: ["backspace", "delete"],
  },

  { id: "attemptWorked", group: "attempt", label: "Worked", keys: ["1"] },
  { id: "attemptPartly", group: "attempt", label: "Partly", keys: ["2"] },
  { id: "attemptSpaghetti", group: "attempt", label: "Spaghetti", keys: ["3"] },
  { id: "attemptLog", group: "attempt", label: "Log it, once the outcome is picked", keys: ["enter"] },

  { id: "journalNext", group: "journal", label: "Next entry", keys: ["j"] },
  { id: "journalPrevious", group: "journal", label: "Previous entry", keys: ["k"] },
  { id: "journalOpen", group: "journal", label: "Open the picked entry", keys: ["enter"] },
  { id: "journalClear", group: "journal", label: "Let go of the picked entry", keys: ["escape"] },

  { id: "weekPrevious", group: "week", label: "Previous week", keys: ["arrowleft"] },
  { id: "weekNext", group: "week", label: "Next week", keys: ["arrowright"] },

  { id: "searchNext", group: "search", label: "Next result", keys: ["arrowdown"] },
  { id: "searchPrevious", group: "search", label: "Previous result", keys: ["arrowup"] },
  { id: "searchOpen", group: "search", label: "Open the picked result", keys: ["enter"] },

  { id: "pantryAdd", group: "pantry", label: "Add a spool", keys: ["n"] },
  { id: "shoppingAdd", group: "shopping", label: "Add something to buy", keys: ["n"] },

  { id: "spoolBack", group: "spool", label: "Back to the Pantry", keys: ["escape"] },
  { id: "spoolDelete", group: "spool", label: "Take it out of the pantry, with undo", keys: ["backspace", "delete"] },
]);

export type ShortcutId = (typeof SHORTCUTS)[number]["id"];

const byId = new Map<string, (typeof SHORTCUTS)[number]>(SHORTCUTS.map((shortcut) => [shortcut.id, shortcut]));

export function shortcutKeys(id: ShortcutId): readonly string[] {
  return byId.get(id)?.keys ?? [];
}

/** The shortcuts that work in one place, in the order they are listed. */
export function shortcutsIn(group: ShortcutGroup) {
  return SHORTCUTS.filter((shortcut) => shortcut.group === group);
}

/** Whether a pressed combo (see `comboOf`) is one of this shortcut's keys. */
export function isShortcut(id: ShortcutId, combo: string | null): boolean {
  return combo !== null && shortcutKeys(id).includes(combo);
}

const KEY_NAMES: Record<string, string> = {
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  enter: "↵",
  escape: "Esc",
  backspace: "⌫",
  delete: "Del",
};

/** A key combo as separate keycaps: "g i" → ["G", "I"], "mod+k" → ["⌘", "K"]. */
export function keycaps(combo: string, mac: boolean): string[] {
  return combo.split(" ").flatMap((step) =>
    step.split("+").map((part) => {
      if (part === "mod") return mac ? "⌘" : "Ctrl";
      return KEY_NAMES[part] ?? (part.length === 1 ? part.toUpperCase() : part);
    }),
  );
}
