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
  /** Shown as a hint in the sidebar. */
  keys: string[];
  /** The hotkey sequence that opens it, as useHotkeys expects. */
  hotkey: string;
}

/** The four sections, in order. The shell, hotkeys and tests read this list. */
export const sections: Section[] = [
  { to: "/ideas", label: "Ideas", icon: IdeasIcon, keys: ["G", "I"], hotkey: "g i" },
  { to: "/builds", label: "Builds", icon: BuildsIcon, keys: ["G", "B"], hotkey: "g b" },
  { to: "/journal", label: "Journal", icon: JournalIcon, keys: ["G", "J"], hotkey: "g j" },
  { to: "/search", label: "Search", icon: SearchIcon, keys: ["/"], hotkey: "/" },
];

/**
 * The workshop: the spools on hand and the printer. In the sidebar below the
 * sections on desktop, in the account sheet on phones (the tab bar keeps four).
 */
export const workshop: Section[] = [
  { to: "/pantry", label: "Pantry", icon: PantryIcon, keys: ["G", "P"], hotkey: "g p" },
  { to: "/printer", label: "Printer", icon: PrinterIcon, keys: ["G", "R"], hotkey: "g r" },
];
