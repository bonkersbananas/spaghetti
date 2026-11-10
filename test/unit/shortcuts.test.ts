import { describe, expect, it } from "vitest";
import {
  isShortcut,
  keycaps,
  SHORTCUT_COLUMNS,
  SHORTCUT_GROUPS,
  SHORTCUTS,
  shortcutsIn,
} from "../../src/shared/shortcuts.ts";

describe("shortcut registry", () => {
  it("gives every shortcut its own id", () => {
    const ids = SHORTCUTS.map((shortcut) => shortcut.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("lists every group, and every shortcut sits in a known one", () => {
    for (const shortcut of SHORTCUTS) expect(SHORTCUT_GROUPS).toContain(shortcut.group);
    for (const group of SHORTCUT_GROUPS) expect(shortcutsIn(group).length).toBeGreaterThan(0);
  });

  it("lays out every group in the overlay exactly once", () => {
    expect([...SHORTCUT_COLUMNS.flat()].sort()).toEqual([...SHORTCUT_GROUPS].sort());
  });

  it("never binds one key twice on the same screen", () => {
    // What is live at once: the shortcuts that work anywhere, plus one screen's own (the palette is a screen of its own).
    for (const group of SHORTCUT_GROUPS) {
      if (group === "anywhere") continue;
      const keys = [...shortcutsIn("anywhere"), ...shortcutsIn(group)].flatMap((shortcut) => shortcut.keys);
      expect(
        keys.filter((key, index) => keys.indexOf(key) !== index),
        group,
      ).toEqual([]);
    }
  });

  it("writes keys in the form the listener reports them", () => {
    for (const { keys } of SHORTCUTS) {
      for (const key of keys) expect(key).toBe(key.toLowerCase());
    }
  });

  it("keeps the shortcuts that existed before the palette", () => {
    const has = (id: string, key: string) => isShortcut(id as never, key);
    expect(has("capture", "c")).toBe(true);
    expect(has("goIdeas", "g i")).toBe(true);
    expect(has("goBuilds", "g b")).toBe(true);
    expect(has("goJournal", "g j")).toBe(true);
    expect(has("search", "/")).toBe(true);
    expect(has("buildLog", "a")).toBe(true);
    expect(has("ideaBuild", "b")).toBe(true);
    expect(has("buildNext", "j")).toBe(true);
    expect(has("buildPrevious", "arrowup")).toBe(true);
    expect(has("journalNext", "j")).toBe(true);
    expect(has("buildOpen", "enter")).toBe(true);
    expect(has("ideaBack", "escape")).toBe(true);
    expect(has("ideaPhotoNext", "arrowright")).toBe(true);
    expect(has("ideaDelete", "backspace")).toBe(true);
    expect(has("buildDelete", "delete")).toBe(true);
  });
});

describe("keycaps", () => {
  it("splits sequences and names the modifier for the platform", () => {
    expect(keycaps("g i", false)).toEqual(["G", "I"]);
    expect(keycaps("mod+k", true)).toEqual(["⌘", "K"]);
    expect(keycaps("mod+k", false)).toEqual(["Ctrl", "K"]);
    expect(keycaps("arrowdown", false)).toEqual(["↓"]);
    expect(keycaps("?", false)).toEqual(["?"]);
  });
});
