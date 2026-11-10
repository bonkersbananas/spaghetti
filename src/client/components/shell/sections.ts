import {
  BuildsIcon,
  type Icon,
  IdeasIcon,
  JournalIcon,
  PantryIcon,
  PrinterIcon,
  SearchIcon,
} from "@/components/ui/icons";

export interface Section {
  to: "/ideas" | "/builds" | "/journal" | "/search" | "/pantry" | "/printer";
  label: string;
  icon: Icon;
  /** The shortcut that opens it (see shared/shortcuts.ts); the sidebar shows its keys. */
  shortcut: "goIdeas" | "goBuilds" | "goJournal" | "search" | "goPantry" | "goPrinter";
}

/** The four sections, in order. The shell, hotkeys and tests read this list. */
export const sections: Section[] = [
  { to: "/ideas", label: "Ideas", icon: IdeasIcon, shortcut: "goIdeas" },
  { to: "/builds", label: "Builds", icon: BuildsIcon, shortcut: "goBuilds" },
  { to: "/journal", label: "Journal", icon: JournalIcon, shortcut: "goJournal" },
  { to: "/search", label: "Search", icon: SearchIcon, shortcut: "search" },
];

/**
 * The workshop: the spools on hand and the printer. In the sidebar below the
 * sections on desktop, in the account sheet on phones (the tab bar keeps four).
 */
export const workshop: Section[] = [
  { to: "/pantry", label: "Pantry", icon: PantryIcon, shortcut: "goPantry" },
  { to: "/printer", label: "Printer", icon: PrinterIcon, shortcut: "goPrinter" },
];
