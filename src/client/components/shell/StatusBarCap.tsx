import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

/**
 * The strip over an iPhone's status bar (and the Dynamic Island) in the Home Screen app, where the
 * page draws under it. It is clear at rest, so a title is never frosted, and only fades in once the
 * page has scrolled and content would otherwise run behind the clock. It is as tall as the top safe
 * area, so it is nothing at all where there is none (desktop, browser tabs).
 */
export function StatusBarCap() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 4);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  return (
    <div
      aria-hidden
      data-status-bar-cap
      className={cn(
        "bg-paper/80 duration-base pointer-events-none fixed inset-x-0 top-0 z-40 h-[var(--sg-safe-top)] backdrop-blur-xl transition-opacity md:hidden",
        scrolled ? "opacity-100" : "opacity-0",
      )}
    />
  );
}
