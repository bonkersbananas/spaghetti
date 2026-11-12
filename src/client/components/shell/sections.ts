import {
  BuildsIcon,
  type Icon,
  IdeasIcon,
  JournalIcon,
  PantryIcon,
  PrinterIcon,
  SearchIcon,
  ShoppingIcon,
  TodayIcon,
  TwistIcon,
  WishIcon,
  WorkshopIcon,
} from "@/components/ui/icons";

export interface Section {
  to:
    | "/today"
    | "/ideas"
    | "/workshop"
    | "/wishlist"
    | "/builds"
    | "/twists"
    | "/journal"
    | "/search"
    | "/pantry"
    | "/printer"
    | "/shopping";
  label: string;
  icon: Icon;
  /** The shortcut that opens it (see shared/shortcuts.ts); the sidebar shows its keys. */
  shortcut:
    | "goToday"
    | "goIdeas"
    | "goWishlist"
    | "goBuilds"
    | "goTwists"
    | "goJournal"
    | "search"
    | "goPantry"
    | "goPrinter"
    | "goShopping";
}

const today: Section = { to: "/today", label: "Today", icon: TodayIcon, shortcut: "goToday" };
const ideas: Section = { to: "/ideas", label: "Ideas", icon: IdeasIcon, shortcut: "goIdeas" };
const wishlist: Section = { to: "/wishlist", label: "Wishlists", icon: WishIcon, shortcut: "goWishlist" };
const builds: Section = { to: "/builds", label: "Builds", icon: BuildsIcon, shortcut: "goBuilds" };
const twists: Section = { to: "/twists", label: "Twists", icon: TwistIcon, shortcut: "goTwists" };
const journal: Section = { to: "/journal", label: "Journal", icon: JournalIcon, shortcut: "goJournal" };
/** The phone's fourth tab: the hub for the three places of the workshop (it has no sidebar entry or shortcut). */
const workshopTab: Pick<Section, "to" | "label" | "icon"> = { to: "/workshop", label: "Workshop", icon: WorkshopIcon };
const search: Section = { to: "/search", label: "Search", icon: SearchIcon, shortcut: "search" };

/** Every section, in order: the sidebar, the hotkeys and the command palette read this list. */
export const sections: Section[] = [today, ideas, wishlist, builds, twists, journal, search];

/**
 * The phone's tabs, around the capture button: places only. Search is a tool, so it lives in the page
 * header on phones (see PageHeader). Wishlists are reached from Ideas on phones.
 */
export const tabs = [ideas, builds, journal, workshopTab] as const;

/**
 * The workshop: the spools on hand, the printer and what to buy for it. In the sidebar below the
 * sections on desktop; on phones the Workshop tab opens a page with the three (routes/_app/workshop.tsx).
 */
export const workshop: Section[] = [
  { to: "/pantry", label: "Pantry", icon: PantryIcon, shortcut: "goPantry" },
  { to: "/printer", label: "Printer", icon: PrinterIcon, shortcut: "goPrinter" },
  { to: "/shopping", label: "Shopping list", icon: ShoppingIcon, shortcut: "goShopping" },
];
