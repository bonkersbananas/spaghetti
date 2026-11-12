import { Link, useRouter } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { BackIcon } from "@/components/ui/icons";
import { Kbd } from "@/components/ui/Kbd";
import { previousPlace } from "@/lib/previous-path";

interface DetailBarProps {
  /** Where "back" goes: the section the detail belongs to. */
  back: { to: "/ideas" | "/builds" | "/pantry" | "/twists"; label: string };
  /** The screen's actions, on the right. */
  children?: ReactNode;
}

/**
 * The top of a detail screen: a clear way back (Escape on desktop), and the
 * screen's actions. Sticky and translucent on phones.
 */
export function DetailBar({ back, children }: DetailBarProps) {
  const router = useRouter();
  return (
    <div className="bg-paper/90 sticky top-[var(--sg-safe-top)] z-20 -mx-5 mb-0 flex h-14 items-center justify-between gap-2 px-2 backdrop-blur-xl md:static md:mx-0 md:mb-6 md:h-auto md:bg-transparent md:px-0 md:pt-8 md:backdrop-blur-none">
      <Link
        to={back.to}
        // From the list itself, "back" is a step back in history, not a new page on top: the list is as it was
        // (its scroll position, the card you came from), and the back button doesn't walk the same two pages forever.
        onClick={(event) => {
          if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
          if (previousPlace() !== back.to) return;
          event.preventDefault();
          router.history.back();
        }}
        className="pressable focus-ring text-body text-ink-soft hover:text-ink flex h-11 items-center gap-1 rounded-md pr-3 pl-1.5 font-semibold md:h-9 md:pl-1"
      >
        <BackIcon size={22} weight="bold" aria-hidden />
        {back.label}
        <Kbd keys={["Esc"]} className="ml-1.5" />
      </Link>
      <div className="flex items-center gap-1">{children}</div>
    </div>
  );
}
