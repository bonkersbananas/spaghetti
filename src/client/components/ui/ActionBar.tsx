import { type ReactNode, useEffect } from "react";
import { cn } from "@/lib/cn";

interface ActionBarProps {
  children: ReactNode;
  /**
   * `page` (the default): the page's own paper behind the buttons, fading in from above, for a list's one floating
   * add-action ("New build"), which should read as a pill over the list, not as another row. `tray`: a screen's own
   * actions over page text ("Start building" under an idea's thread): a solid cream surface of its own, rounded at the
   * top and casting upward, that sits on the tab bar as one dock, so no line of text ever reads through or beside the
   * buttons.
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
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--sg-actionbar-offset", "var(--sg-actionbar-height)");
    return () => {
      root.style.removeProperty("--sg-actionbar-offset");
    };
  }, []);
  return (
    <>
      <div aria-hidden className="h-actionbar md:hidden" />
      <div
        data-action-bar={surface}
        className={cn(
          "bottom-tabbar fixed inset-x-0 z-20 px-5 pt-3 pb-3 md:hidden",
          surface === "tray"
            ? "bg-cream shadow-bar rounded-t-xl"
            : "bg-paper before:from-paper before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-6 before:bg-linear-to-t before:to-transparent",
          className,
        )}
      >
        <div className="mx-auto flex max-w-lg items-center gap-3">{children}</div>
      </div>
    </>
  );
}
