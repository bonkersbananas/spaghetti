import { Link } from "@tanstack/react-router";
import type { MouseEvent, ReactNode } from "react";
import { BackIcon } from "@/components/ui/icons";
import { Kbd } from "@/components/ui/Kbd";
import { useBackTo } from "@/lib/origin";

interface DetailBarProps {
  /** The section the detail belongs to: where "back" goes when the page wasn't opened from somewhere in the app. */
  back: { to: "/ideas" | "/builds" | "/pantry" | "/twists"; label: string };
  /** The page's own title: the way back never just echoes it. */
  title?: string;
  /** The screen's actions, on the right. */
  children?: ReactNode;
}

const backClass =
  "pressable focus-ring text-body text-ink-soft hover:text-ink flex h-11 min-w-0 max-w-[60%] items-center gap-1 rounded-md pr-3 pl-1.5 font-semibold md:h-9 md:max-w-sm md:pl-1";

/**
 * The top of a detail screen: a clear way back (Escape on desktop), named for where it goes (the page an idea or build
 * was opened from, else its list), and the screen's actions. Sticky and translucent on phones.
 */
export function DetailBar({ back, title, children }: DetailBarProps) {
  const to = useBackTo(back, title);
  // A plain click goes back (a step back in history: the page before is as it was); a new tab gets the address.
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    to.go();
  };
  const content = (
    <>
      <BackIcon size={22} weight="bold" aria-hidden className="shrink-0" />
      <span className="truncate">{to.label}</span>
      <Kbd keys={["Esc"]} className="ml-1.5 shrink-0" />
    </>
  );
  return (
    <div className="bg-paper/90 sticky top-[var(--sg-safe-top)] z-20 -mx-5 mb-0 flex h-14 items-center justify-between gap-2 px-2 backdrop-blur-xl md:static md:mx-0 md:mb-6 md:h-auto md:bg-transparent md:px-0 md:pt-8 md:backdrop-blur-none">
      {to.fromOrigin ? (
        // An item's name may be cut short: hovering shows all of it.
        <a href={to.href} onClick={onClick} title={to.label} className={backClass}>
          {content}
        </a>
      ) : (
        <Link to={back.to} onClick={onClick} className={backClass}>
          {content}
        </Link>
      )}
      <div className="flex shrink-0 items-center gap-1">{children}</div>
    </div>
  );
}
