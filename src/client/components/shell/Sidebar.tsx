import type { Person } from "@shared/api";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { lazy, Suspense, useRef, useState } from "react";
import { Mark } from "@/components/illustrations";
import { Button } from "@/components/ui/Button";
import { PlusIcon, SearchIcon } from "@/components/ui/icons";
import { Kbd } from "@/components/ui/Kbd";
import { Overline } from "@/components/ui/Overline";
import { UnreadDot } from "@/components/ui/UnreadDot";
import { useCapture } from "@/lib/capture";
import { shortcutCaps } from "@/lib/hotkeys";
import { holdKeyboard } from "@/lib/keyboard-proxy";
import { usePalette } from "@/lib/palette";
import { sessionQuery } from "@/lib/queries";
import { useAnyUnread } from "@/lib/unread-comments";
import { useWhenIdle } from "@/lib/when-idle";
import { AccountButton } from "./AccountButton";
import { AccountMenu, loadAccountMenu } from "./lazy-account";
import { type Section, sections, workshop } from "./sections";

/** The print on the bed: its code (builds, progress, photos) loads once the browser is idle, not with the first screen. */
const loadNowPrinting = () => import("./NowPrinting").then((module) => ({ default: module.NowPrinting }));
const NowPrinting = lazy(loadNowPrinting);

/** Mounts the lazy NowPrinting once its code has arrived; nothing shows before (it only shows when a print is on). */
function LateNowPrinting() {
  const [ready, setReady] = useState(false);
  useWhenIdle(() => {
    void loadNowPrinting().then(() => setReady(true));
  });
  if (!ready) return null;
  return (
    <Suspense fallback={null}>
      <NowPrinting />
    </Suspense>
  );
}

const itemClass =
  "pressable focus-ring group flex h-9 items-center gap-3 rounded-sm px-3 text-body font-medium text-ink-soft hover:bg-ink/5 hover:text-ink data-[status=active]:bg-cream data-[status=active]:text-ink data-[status=active]:shadow-soft data-[status=active]:focus-visible:shadow-ring";

/** The sidebar's links: an icon, the name, and the key to press. */
function NavItems({ items }: { items: Section[] }) {
  const unread = useAnyUnread();
  return items.map(({ to, label, icon: Icon, shortcut }) => (
    <Link key={to} to={to} className={itemClass}>
      {({ isActive }) => (
        <>
          {/* What waits unread is on Today (the comment line): the dot sits on the icon's corner, as on the tab bar. */}
          <span className="relative flex">
            <Icon
              size={20}
              weight={isActive ? "fill" : "regular"}
              className={isActive ? "text-tomato" : "text-ink-faint group-hover:text-ink-soft"}
              aria-hidden
            />
            {to === "/today" && unread && !isActive && (
              <UnreadDot label="Something new" ring="ring-paper-deep" className="absolute -top-0.5 -right-1" />
            )}
          </span>
          <span className="flex-1">{label}</span>
          <Kbd
            keys={shortcutCaps(shortcut)}
            className="duration-fast opacity-60 transition-opacity group-hover:opacity-100"
          />
        </>
      )}
    </Link>
  ));
}

/** Desktop navigation: always visible, keyboard hints beside each section. */
export function Sidebar() {
  const { setOpen } = useCapture();
  const { data: user } = useSuspenseQuery(sessionQuery);
  const { setPaletteOpen } = usePalette();

  return (
    <aside className="paper-grain w-sidebar bg-paper-deep fixed inset-y-0 left-0 hidden flex-col px-3 pt-5 pb-3 md:flex">
      <Link
        to="/today"
        className="focus-ring hover:bg-ink/5 duration-fast mb-6 flex items-center gap-2.5 rounded-sm px-2 py-1 transition-colors"
      >
        <Mark className="size-7" />
        <span className="font-display text-title text-ink font-semibold tracking-tight">Spaghetti</span>
      </Link>

      <Button
        variant="primary"
        icon={PlusIcon}
        shortcut={shortcutCaps("capture")}
        fullWidth
        // On a touch tablet the keyboard comes up inside the tap, for the note (lib/keyboard-proxy.ts).
        onClick={() => {
          holdKeyboard();
          setOpen(true);
        }}
      >
        New idea
      </Button>

      <button
        type="button"
        onClick={() => {
          holdKeyboard();
          setPaletteOpen(true);
        }}
        aria-keyshortcuts="Control+K Meta+K"
        className="pressable focus-ring bg-ink/4 shadow-well text-small text-ink-faint hover:text-ink-soft mt-3 flex h-9 w-full items-center gap-2.5 rounded-md px-3 text-left"
      >
        <SearchIcon size={16} aria-hidden />
        <span className="flex-1">Jump to…</span>
        <Kbd keys={shortcutCaps("palette")} />
      </button>

      <nav aria-label="Sections" className="mt-5 flex flex-col gap-0.5">
        <NavItems items={sections} />
      </nav>

      <nav aria-label="Workshop" className="mt-6 flex flex-col gap-0.5">
        <Overline className="mb-1 px-3">Workshop</Overline>
        <NavItems items={workshop} />
      </nav>

      <div className="mt-auto flex flex-col">
        <LateNowPrinting />
        {user && <SidebarAccount user={user} />}
      </div>
    </aside>
  );
}

/**
 * The account button, and the menu it opens: theme, agents, notifications, password, sign out. The menu's code
 * (the popover, the theme switch, the password sheet) is rarely needed, so it arrives while the browser is idle
 * after the first screen, or when the button is pressed first; until then a look-alike button stands in.
 */
function SidebarAccount({ user }: { user: Person }) {
  // Whether the menu's code is wanted (idle time or the first press), and whether the menu is open. The open state
  // lives here, so a press opens it even when it lands on the stand-in just as the real menu mounts.
  const [wanted, setWanted] = useState(false);
  const [open, setOpen] = useState(false);
  // The look-alike is replaced by the real button: if it had focus (tabbed to, or just pressed), the new one takes it,
  // rather than focus falling to the page and the next Tab starting from the top.
  const hadFocus = useRef(false);
  const keepFocus = () => {
    hadFocus.current = document.activeElement?.hasAttribute("data-account-button") ?? false;
  };
  useWhenIdle(() => {
    void loadAccountMenu().then(() => {
      keepFocus();
      setWanted(true);
    });
  });
  const stand = (
    <AccountButton
      user={user}
      onClick={() => {
        setWanted(true);
        setOpen(true);
      }}
    />
  );
  if (!wanted) return stand;
  return (
    <Suspense fallback={stand}>
      <AccountMenu
        user={user}
        open={open}
        onOpenChange={setOpen}
        takeFocus={() => {
          const had = hadFocus.current;
          hadFocus.current = false;
          return had;
        }}
      />
    </Suspense>
  );
}
