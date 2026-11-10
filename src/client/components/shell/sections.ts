import { BuildsIcon, type Icon, IdeasIcon, JournalIcon, SearchIcon } from "@/components/ui/icons";

export interface Section {
  to: "/ideas" | "/builds" | "/journal" | "/search";
  label: string;
  icon: Icon;
  /** The shortcut that opens it (see shared/shortcuts.ts); the sidebar shows its keys. */
  shortcut: "goIdeas" | "goBuilds" | "goJournal" | "search";
}

/** The four sections, in order. The shell, hotkeys and tests read this list. */
export const sections: Section[] = [
  { to: "/ideas", label: "Ideas", icon: IdeasIcon, shortcut: "goIdeas" },
  { to: "/builds", label: "Builds", icon: BuildsIcon, shortcut: "goBuilds" },
  { to: "/journal", label: "Journal", icon: JournalIcon, shortcut: "goJournal" },
  { to: "/search", label: "Search", icon: SearchIcon, shortcut: "search" },
];
