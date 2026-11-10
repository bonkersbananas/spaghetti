import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Mark } from "@/components/illustrations";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { CaretUpDownIcon, PaletteIcon, PlusIcon, SearchIcon, SignOutIcon } from "@/components/ui/icons";
import { Kbd } from "@/components/ui/Kbd";
import { Popover } from "@/components/ui/Popover";
import { useCapture } from "@/lib/capture";
import { shortcutCaps } from "@/lib/hotkeys";
import { usePalette } from "@/lib/palette";
import { sessionQuery } from "@/lib/queries";
import { useSignOut } from "@/lib/use-sign-out";
import { sections, workshop } from "./sections";
import { ThemeSwitch } from "./ThemeSwitch";

const itemClass =
  "pressable focus-ring group flex h-9 items-center gap-3 rounded-sm px-3 text-body font-medium text-ink-soft hover:bg-ink/5 hover:text-ink data-[status=active]:bg-cream data-[status=active]:text-ink data-[status=active]:shadow-soft";

/** Desktop navigation: always visible, keyboard hints beside each section. */
export function Sidebar() {
  const { setOpen } = useCapture();
  const { data: user } = useSuspenseQuery(sessionQuery);
  const signOut = useSignOut();
  const { setPaletteOpen } = usePalette();

  return (
    <aside className="paper-grain w-sidebar bg-paper-deep fixed inset-y-0 left-0 hidden flex-col px-3 pt-5 pb-3 md:flex">
      <Link to="/ideas" className="focus-ring mb-6 flex items-center gap-2.5 rounded-sm px-2 py-1">
        <Mark className="size-7" />
        <span className="font-display text-title text-ink font-semibold tracking-tight">Spaghetti</span>
      </Link>

      <Button
        variant="primary"
        icon={PlusIcon}
        shortcut={shortcutCaps("capture")}
        fullWidth
        onClick={() => setOpen(true)}
      >
        New idea
      </Button>

      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        aria-keyshortcuts="Control+K Meta+K"
        className="pressable focus-ring bg-ink/4 shadow-well text-small text-ink-faint hover:text-ink-soft mt-3 flex h-9 w-full items-center gap-2.5 rounded-md px-3 text-left"
      >
        <SearchIcon size={16} aria-hidden />
        <span className="flex-1">Jump to…</span>
        <Kbd keys={shortcutCaps("palette")} />
      </button>

      <nav aria-label="Sections" className="mt-5 flex flex-col gap-0.5">
        {sections.map(({ to, label, icon: Icon, shortcut }) => (
          <Link key={to} to={to} className={itemClass}>
            {({ isActive }) => (
              <>
                <Icon
                  size={20}
                  weight={isActive ? "fill" : "regular"}
                  className={isActive ? "text-tomato" : "text-ink-faint group-hover:text-ink-soft"}
                  aria-hidden
                />
                <span className="flex-1">{label}</span>
                <Kbd
                  keys={shortcutCaps(shortcut)}
                  className="duration-fast opacity-60 transition-opacity group-hover:opacity-100"
                />
              </>
            )}
          </Link>
        ))}
      </nav>

      <nav aria-label="Workshop" className="mt-6 flex flex-col gap-0.5">
        <span className="text-caption text-ink-faint mb-1 px-3 font-semibold tracking-wider uppercase">Workshop</span>
        {workshop.map(({ to, label, icon: Icon, shortcut }) => (
          <Link key={to} to={to} className={itemClass}>
            {({ isActive }) => (
              <>
                <Icon
                  size={20}
                  weight={isActive ? "fill" : "regular"}
                  className={isActive ? "text-tomato" : "text-ink-faint group-hover:text-ink-soft"}
                  aria-hidden
                />
                <span className="flex-1">{label}</span>
                <Kbd
                  keys={shortcutCaps(shortcut)}
                  className="duration-fast opacity-60 transition-opacity group-hover:opacity-100"
                />
              </>
            )}
          </Link>
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-0.5">
        <Link to="/styleguide" className={itemClass}>
          {({ isActive }) => (
            <>
              <PaletteIcon
                size={20}
                weight={isActive ? "fill" : "regular"}
                className={isActive ? "text-tomato" : "text-ink-faint"}
                aria-hidden
              />
              <span className="text-small flex-1">Styleguide</span>
            </>
          )}
        </Link>
        {user && (
          <Popover
            label="Account"
            side="top"
            align="start"
            trigger={
              <button
                type="button"
                className="pressable focus-ring hover:bg-ink/5 data-[state=open]:bg-ink/5 mt-2 flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left"
              >
                <Avatar person={user} size="sm" />
                <span className="text-small text-ink min-w-0 flex-1 truncate font-semibold">{user.name}</span>
                <CaretUpDownIcon size={16} className="text-ink-faint" aria-hidden />
                <span className="sr-only">Account menu</span>
              </button>
            }
          >
            <div className="flex flex-col gap-4">
              <ThemeSwitch />
              <Button variant="quiet" icon={SignOutIcon} fullWidth onClick={signOut} className="justify-start">
                Sign out
              </Button>
            </div>
          </Popover>
        )}
      </div>
    </aside>
  );
}
