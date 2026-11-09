import { Link } from "@tanstack/react-router";
import { PlusIcon } from "@/components/ui/icons";
import { useCapture } from "@/lib/capture";
import { type Section, sections } from "./sections";

function Tab({ to, label, icon: Icon }: Section) {
  return (
    <Link
      to={to}
      className="pressable group text-ink-faint data-[status=active]:text-tomato-ink flex flex-1 flex-col items-center justify-center gap-0.5"
    >
      {({ isActive }) => (
        <>
          <Icon size={26} weight={isActive ? "fill" : "regular"} aria-hidden />
          <span className="text-caption font-semibold">{label}</span>
        </>
      )}
    </Link>
  );
}

/**
 * Phone navigation, within thumb reach. The capture button sits in the
 * middle, a little larger, because capturing is the main thing people do.
 */
export function TabBar() {
  const { setOpen } = useCapture();
  const [ideas, builds, journal, search] = sections as [Section, Section, Section, Section];
  return (
    <nav
      aria-label="Sections"
      className="bg-cream/92 pb-safe shadow-bar fixed inset-x-0 bottom-0 z-30 backdrop-blur-xl md:hidden"
    >
      <div className="h-tabbar mx-auto flex max-w-lg items-stretch px-2">
        <Tab {...ideas} />
        <Tab {...builds} />
        <div className="flex flex-1 items-center justify-center">
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="New idea"
            className="pressable focus-ring bg-tomato text-on-accent shadow-raised flex size-14 items-center justify-center rounded-lg"
          >
            <PlusIcon size={28} weight="bold" aria-hidden />
          </button>
        </div>
        <Tab {...journal} />
        <Tab {...search} />
      </div>
    </nav>
  );
}
