import { Link, useRouterState } from "@tanstack/react-router";
import { PlusIcon } from "@/components/ui/icons";
import { useCapture } from "@/lib/capture";
import { isSelected, usePendingNav } from "@/lib/pending-nav";
import { type Section, tabs } from "./sections";

function Tab({
  to,
  label,
  icon: Icon,
  pendingTo,
  press,
}: Section & { pendingTo: string | null; press: (to: string) => void }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const selected = isSelected(to, pathname, pendingTo);
  return (
    <Link
      to={to}
      onClick={() => press(to)}
      data-selected={selected || undefined}
      // Each section's code is fetched once the app is idle (routes/_app.tsx), and on the touch itself.
      className="pressable press-none group text-ink-faint data-[selected]:text-tomato-ink flex flex-1 flex-col items-center justify-center gap-0.5"
    >
      {() => (
        <>
          {/* The held highlight: a soft round behind the icon. */}
          <span className="group-active:bg-pressed group-data-[pressed]:bg-pressed rounded-pill flex h-8 w-12 items-center justify-center">
            <Icon size={26} weight={selected ? "fill" : "regular"} aria-hidden />
          </span>
          <span className="text-caption font-semibold">{label}</span>
        </>
      )}
    </Link>
  );
}

/**
 * Phone navigation, within thumb reach: Today, Ideas, capture, Builds, Journal.
 * The capture button sits in the middle, a little larger, because capturing is
 * the main thing people do. Search is a tool, not a place: it is in the page header.
 */
export function TabBar() {
  const { setOpen } = useCapture();
  const [today, ideas, builds, journal] = tabs;
  const nav = usePendingNav();
  return (
    <nav
      aria-label="Sections"
      className="bg-cream/92 pb-safe shadow-bar fixed inset-x-0 bottom-0 z-30 backdrop-blur-xl md:hidden"
    >
      <div className="h-tabbar-row mx-auto flex max-w-lg items-stretch px-2">
        <Tab {...today} {...nav} />
        <Tab {...ideas} {...nav} />
        <div className="flex flex-1 items-center justify-center">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="New idea"
            className="pressable press-tomato focus-ring bg-tomato text-on-accent shadow-raised flex size-14 items-center justify-center rounded-lg"
          >
            <PlusIcon size={28} weight="bold" aria-hidden />
          </button>
        </div>
        <Tab {...builds} {...nav} />
        <Tab {...journal} {...nav} />
      </div>
    </nav>
  );
}
