import { type ReactNode, useEffect } from "react";
import { cn } from "@/lib/cn";

/** The tray's height: the bar's (`--sg-actionbar-height`, pt-3) with the room above its button as at its sides (pt-5). */
const TRAY_HEIGHT = "calc(var(--sg-actionbar-height) + 0.5rem)";

/** Trays showing now (a route change can mount the next page's before the last one's unmounts). */
let trays = 0;

interface ActionBarProps {
  children: ReactNode;
  /**
   * `page` (the default): the page's own paper behind the buttons, fading in from above, for a list's one floating
   * add-action ("New build"), which should read as a pill over the list, not as another row. `tray`: a screen's own
   * actions over page text ("Start building" under an idea's thread): a shelf of solid cream on the tab bar, its top
   * corners no rounder than the button's and as much room above the button as at its sides, casting upward. While it
   * shows, the tab bar is the same solid cream with no edge of its own (`html[data-action-tray]`), so the two read as
   * one surface and no line of text ever reads through or beside the buttons.
   */
  surface?: "page" | "tray";
  className?: string;
}

/**
 * A screen's main action within thumb reach on phones: a bar that sits on top of the tab bar (such as "Log attempt" on
 * a build), so content scrolling under it never shows through a quiet button. Hidden on desktop, where the action
 * lives in the page. It keeps room for itself at the end of the page, and toasts move up above it while it shows.
 */
export function ActionBar({ children, surface = "page", className }: ActionBarProps) {
  const tray = surface === "tray";
  useEffect(() => {
    const root = document.documentElement;
    // The tray is taller by the room above its button (pt-5, not pt-3): toasts move up by that much more.
    root.style.setProperty("--sg-actionbar-offset", tray ? TRAY_HEIGHT : "var(--sg-actionbar-height)");
    if (tray) trays += 1;
    root.toggleAttribute("data-action-tray", trays > 0);
    return () => {
      root.style.removeProperty("--sg-actionbar-offset");
      if (tray) trays -= 1;
      root.toggleAttribute("data-action-tray", trays > 0);
    };
  }, [tray]);
  return (
    <>
      <div aria-hidden className="h-actionbar md:hidden" style={tray ? { height: TRAY_HEIGHT } : undefined} />
      <div
        data-action-bar={surface}
        className={cn(
          "bottom-tabbar fixed inset-x-0 z-20 px-5 pb-3 md:hidden",
          tray
            ? "bg-cream shadow-bar rounded-t-lg pt-5"
            : "bg-paper before:from-paper pt-3 before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-6 before:bg-linear-to-t before:to-transparent",
          className,
        )}
      >
        <div className="mx-auto flex max-w-lg items-center gap-3">{children}</div>
      </div>
    </>
  );
}
