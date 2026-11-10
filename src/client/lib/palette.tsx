import type { ShortcutId } from "@shared/shortcuts";
import { createContext, type ReactNode, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import type { Icon } from "@/components/ui/icons";

/** Something the palette can do for the screen it is opened on. */
export interface ScreenAction {
  id: string;
  label: string;
  icon: Icon;
  /** Extra words that find it ("finish" finds "Log attempt" while one is printing). */
  keywords?: string;
  /** The shortcut that does the same, shown beside it. */
  shortcut?: ShortcutId;
  run: () => void;
}

interface Registered {
  /** "This build": the heading the actions sit under. */
  group: string;
  get: () => ScreenAction[];
}

// Screens register what they can do while they are on screen; the palette reads it when it opens.
const registered = new Map<string, Registered>();

/** The actions of the idea or build on screen, with the heading each sits under. */
export function screenActions(): Array<{ group: string; actions: ScreenAction[] }> {
  return [...registered.values()].map(({ group, get }) => ({ group, actions: get() }));
}

/**
 * Offers actions in the command palette while this screen is shown ("Log
 * attempt" on a build). They come first in the palette. Pass fresh closures
 * every render: the palette calls the latest ones.
 */
export function useScreenActions(group: string, actions: ScreenAction[]) {
  const key = useId();
  const latest = useRef(actions);
  latest.current = actions;
  useEffect(() => {
    registered.set(key, { group, get: () => latest.current });
    return () => void registered.delete(key);
  }, [key, group]);
}

interface PaletteContextValue {
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  helpOpen: boolean;
  setHelpOpen: (open: boolean) => void;
}

const PaletteContext = createContext<PaletteContextValue | null>(null);

/** Whether the command palette and the shortcut list are open. */
export function PaletteProvider({ children }: { children: ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const value = useMemo(() => ({ paletteOpen, setPaletteOpen, helpOpen, setHelpOpen }), [paletteOpen, helpOpen]);
  return <PaletteContext.Provider value={value}>{children}</PaletteContext.Provider>;
}

export function usePalette(): PaletteContextValue {
  const value = useContext(PaletteContext);
  if (!value) throw new Error("usePalette needs <PaletteProvider>");
  return value;
}
