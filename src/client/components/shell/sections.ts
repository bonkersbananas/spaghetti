import {
  BuildsIcon,
  type Icon,
  IdeasIcon,
  InfoIcon,
  JournalIcon,
  PantryIcon,
  PrinterIcon,
  SearchIcon,
  TodayIcon,
} from "@/components/ui/icons";

export interface Section {
  to: "/today" | "/ideas" | "/builds" | "/journal" | "/search" | "/pantry" | "/printer" | "/shopping";
  label: string;
  icon: Icon;
  /** The shortcut that opens it (see shared/shortcuts.ts); the sidebar shows its keys. */
  shortcut: "goToday" | "goIdeas" | "goBuilds" | "goJournal" | "search" | "goPantry" | "goPrinter" | "goShopping";
}

const today: Section = { to: "/today", label: "Today", icon: TodayIcon, shortcut: "goToday" };
const ideas: Section = { to: "/ideas", label: "Ideas", icon: IdeasIcon, shortcut: "goIdeas" };
const builds: Section = { to: "/builds", label: "Builds", icon: BuildsIcon, shortcut: "goBuilds" };
const journal: Section = { to: "/journal", label: "Journal", icon: JournalIcon, shortcut: "goJournal" };
const search: Section = { to: "/search", label: "Search", icon: SearchIcon, shortcut: "search" };

/** Every section, in order: the sidebar, the hotkeys and the command palette read this list. */
export const sections: Section[] = [today, ideas, builds, journal, search];

/**
 * The phone's tabs, around the capture button: places only. Search is a tool, so it lives in the page
 * header on phones (see PageHeader).
 */
export const tabs = [today, ideas, builds, journal] as const;

/**
 * The workshop: the spools on hand and the printer. In the sidebar below the
 * sections on desktop, in the account sheet on phones (the tab bar keeps four).
 */
export const workshop: Section[] = [
  { to: "/pantry", label: "Pantry", icon: PantryIcon, shortcut: "goPantry" },
  { to: "/printer", label: "Printer", icon: PrinterIcon, shortcut: "goPrinter" },
  { to: "/shopping", label: "Shopping", icon: InfoIcon, shortcut: "goShopping" }, // TODO: a Phosphor icon in components/ui/icons.tsx
];
