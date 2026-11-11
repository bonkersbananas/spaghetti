import {
  BuildsIcon,
  type Icon,
  IdeasIcon,
  JournalIcon,
  PantryIcon,
  PrinterIcon,
  SearchIcon,
  TodayIcon,
  WishIcon,
} from "@/components/ui/icons";

export interface Section {
  to: "/today" | "/ideas" | "/wishlist" | "/builds" | "/journal" | "/search" | "/pantry" | "/printer";
  label: string;
  icon: Icon;
  /** The shortcut that opens it (see shared/shortcuts.ts); the sidebar shows its keys. */
  shortcut: "goToday" | "goIdeas" | "goWishlist" | "goBuilds" | "goJournal" | "search" | "goPantry" | "goPrinter";
}

const today: Section = { to: "/today", label: "Today", icon: TodayIcon, shortcut: "goToday" };
const ideas: Section = { to: "/ideas", label: "Ideas", icon: IdeasIcon, shortcut: "goIdeas" };
const wishlist: Section = { to: "/wishlist", label: "Wishlists", icon: WishIcon, shortcut: "goWishlist" };
const builds: Section = { to: "/builds", label: "Builds", icon: BuildsIcon, shortcut: "goBuilds" };
const journal: Section = { to: "/journal", label: "Journal", icon: JournalIcon, shortcut: "goJournal" };
const search: Section = { to: "/search", label: "Search", icon: SearchIcon, shortcut: "search" };

/** Every section, in order: the sidebar, the hotkeys and the command palette read this list. */
export const sections: Section[] = [today, ideas, wishlist, builds, journal, search];

/**
 * The phone's tabs, around the capture button: places only. Search is a tool, so it lives in the page
 * header on phones (see PageHeader). Wishlists are reached from Ideas on phones.
 */
export const tabs = [today, ideas, builds, journal] as const;

/**
 * The workshop: the spools on hand and the printer. In the sidebar below the
 * sections on desktop, in the account sheet on phones (the tab bar keeps four).
 */
export const workshop: Section[] = [
  { to: "/pantry", label: "Pantry", icon: PantryIcon, shortcut: "goPantry" },
  { to: "/printer", label: "Printer", icon: PrinterIcon, shortcut: "goPrinter" },
];
