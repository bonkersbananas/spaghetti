import type { AttemptHit, ItemHit } from "@shared/api";
import { searchTerms, words } from "@shared/search";
import { isShortcut, keycaps, type ShortcutId, shortcutKeys } from "@shared/shortcuts";
import { inlineTime, relativeTime } from "@shared/time";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { OutcomeChip } from "@/components/builds/Outcome";
import { attemptLink, itemLink } from "@/components/search/Results";
import { Highlight } from "@/components/ui/Highlight";
import {
  BuildsIcon,
  CalendarIcon,
  CommentIcon,
  type Icon,
  IdeasIcon,
  KeyboardIcon,
  MoonIcon,
  PaletteIcon,
  PlusIcon,
  SignOutIcon,
  SunIcon,
  SystemThemeIcon,
  TrashIcon,
} from "@/components/ui/icons";
import {
  PaletteDialog,
  type PaletteGroup,
  type PaletteRow,
  PaletteSurface,
  takeEarlyQuery,
} from "@/components/ui/Palette";
import { useCapture } from "@/lib/capture";
import { comboOf, isMac } from "@/lib/hotkeys";
import { type ItemView, useBuilds, useIdeas } from "@/lib/items";
import { type ScreenAction, screenActions, usePalette } from "@/lib/palette";
import { photoSrc } from "@/lib/previews";
import { itemName, type RecentItem, recentItems } from "@/lib/recent";
import { focusSearch, searchQuery } from "@/lib/search";
import { useTheme } from "@/lib/theme";
import { unreadQuery } from "@/lib/unread-comments";
import { useIsDesktop } from "@/lib/use-media-query";
import { useSignOut } from "@/lib/use-sign-out";
import { sections, workshop } from "./sections";

/** How long typing pauses before the search runs. */
const DEBOUNCE_MS = 90;
/** Most results shown from each kind. */
const PER_KIND = 5;

interface Entry {
  id: string;
  group: string;
  row: PaletteRow;
  run: () => void;
}

const caps = (id: ShortcutId | undefined) => {
  const first = id ? shortcutKeys(id)[0] : undefined;
  return first ? keycaps(first, isMac) : undefined;
};

/**
 * ⌘K from anywhere on a laptop: jump to any idea, build or attempt (the
 * search API), or run an action. What fits the screen comes first; before
 * typing it shows recent items. There is none on phones.
 */
export function CommandPalette() {
  const { paletteOpen, setPaletteOpen } = usePalette();
  const isDesktop = useIsDesktop();
  // What the chosen row does, once the palette has gone: a sheet that opened over it would fight its focus.
  const pending = useRef<(() => void) | null>(null);
  return (
    <PaletteDialog
      open={paletteOpen && isDesktop}
      onOpenChange={setPaletteOpen}
      onClosed={(event) => {
        const run = pending.current;
        pending.current = null;
        if (!run) return;
        event.preventDefault();
        run();
      }}
    >
      <PaletteBody
        close={() => setPaletteOpen(false)}
        choose={(run) => {
          pending.current = run;
          setPaletteOpen(false);
        }}
      />
    </PaletteDialog>
  );
}

function PaletteBody({ close, choose }: { close: () => void; choose: (run: () => void) => void }) {
  const navigate = useNavigate();
  // Whatever was typed while the frame was waiting for this code carries over.
  const [query, setQuery] = useState(takeEarlyQuery);
  const [asked, setAsked] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const terms = useMemo(() => searchTerms(query), [query]);

  // The search follows typing a beat later; the rows that need no network answer at once.
  useEffect(() => {
    const timer = setTimeout(() => setAsked(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);
  const searching = searchTerms(asked).length > 0;
  const results = useQuery({ ...searchQuery(asked, new URLSearchParams()), enabled: searching });
  const answered = terms.length > 0 && results.data?.q === query.trim();
  const waiting = terms.length > 0 && !answered && !results.isError;
  const found = terms.length > 0 ? results.data : undefined;
  const foundTerms = useMemo(() => searchTerms(found?.q ?? ""), [found?.q]);

  const { setOpen: openCapture } = useCapture();
  const { resolved, preference, setPreference } = useTheme();
  const { setHelpOpen } = usePalette();
  const signOut = useSignOut();
  // Read once, when the palette opens: the screen's actions and the recent list.
  const [context] = useState(screenActions);
  const [recent] = useState(recentItems);
  // Threads where the other person said something you haven't read: one row each, newest first, above everything else.
  const unread = useQuery(unreadQuery).data?.threads;
  const ideasList = useIdeas().items;
  const buildsList = useBuilds().items;
  const unreadRows = useMemo(
    () =>
      (unread ?? []).flatMap((thread) => {
        const found = [...ideasList, ...buildsList].find((item) => item.id === thread.itemId);
        return found ? [{ item: found, count: thread.count }] : [];
      }),
    [unread, ideasList, buildsList],
  );

  const entries = useMemo<Entry[]>(() => {
    const action = (
      id: string,
      group: string,
      label: string,
      icon: Icon,
      run: () => void,
      shortcut?: ShortcutId,
      keywords = "",
    ): Entry & { words: string[] } => ({
      id,
      group,
      words: words(`${label} ${keywords}`),
      run,
      row: { id, label, title: <Highlight text={label} terms={terms} />, icon, keys: caps(shortcut) },
    });

    const here = context.flatMap(({ group, actions }) =>
      actions.map((a: ScreenAction) => action(`here-${a.id}`, group, a.label, a.icon, a.run, a.shortcut, a.keywords)),
    );
    const goTo = [...sections, ...workshop].map((section) =>
      action(
        `go-${section.to}`,
        "Go to",
        section.label,
        section.icon,
        () => {
          void navigate({ to: section.to });
          if (section.to === "/search") focusSearch();
        },
        section.shortcut,
        `go to open ${section.to.slice(1)}`,
      ),
    );
    // The styleguide has left the sidebar: it is one palette row away.
    goTo.push(
      action(
        "go-/styleguide",
        "Go to",
        "Styleguide",
        PaletteIcon,
        () => void navigate({ to: "/styleguide" }),
        undefined,
        "go to open design tokens components kitchen tools",
      ),
    );
    goTo.push(
      action(
        "go-/deleted",
        "Go to",
        "Recently deleted",
        TrashIcon,
        () => void navigate({ to: "/deleted" }),
        undefined,
        "go to open restore undo deleted trash bin",
      ),
    );
    goTo.push(
      action(
        "go-/year",
        "Go to",
        "Year so far",
        CalendarIcon,
        () => void navigate({ to: "/year" }),
        undefined,
        "go to open year review insights statistics success rate",
      ),
    );
    const general = [
      action("new-idea", "Actions", "New idea", PlusIcon, () => openCapture(true), "capture", "capture add photo note"),
      action(
        "theme",
        "Actions",
        resolved === "dark" ? "Switch to light theme" : "Switch to dark theme",
        resolved === "dark" ? SunIcon : MoonIcon,
        () => setPreference(resolved === "dark" ? "light" : "dark"),
        undefined,
        "appearance mode night day",
      ),
      ...(preference === "system"
        ? []
        : [
            action(
              "theme-system",
              "Actions",
              "Match the system theme",
              SystemThemeIcon,
              () => setPreference("system"),
              undefined,
              "appearance theme automatic",
            ),
          ]),
      action(
        "help",
        "Actions",
        "Show the shortcuts",
        KeyboardIcon,
        () => setHelpOpen(true),
        "help",
        "keyboard keys hotkeys help",
      ),
      action("sign-out", "Actions", "Sign out", SignOutIcon, () => void signOut(), undefined, "log out logout leave"),
    ];
    const matching = <T extends { words: string[] }>(list: T[]) =>
      list.filter((entry) => terms.every((term) => entry.words.some((word) => word.startsWith(term.text))));

    const unreadEntries = unreadRows.map(({ item, count }) => unreadEntry(item, count, navigate));
    if (!terms.length) {
      const items = recent.slice(context.length ? 1 : 0).map((item) => recentEntry(item, navigate));
      return [...here, ...unreadEntries, ...items, ...general, ...goTo];
    }

    const hits = found
      ? [
          ...found.builds.slice(0, PER_KIND).map((hit) => itemEntry(hit, "Builds", foundTerms, navigate)),
          ...found.ideas.slice(0, PER_KIND).map((hit) => itemEntry(hit, "Ideas", foundTerms, navigate)),
          ...found.attempts.slice(0, PER_KIND).map((hit) => attemptEntry(hit, foundTerms, navigate)),
        ]
      : [];
    const unreadMatches = unreadEntries.filter((entry) =>
      terms.every((term) => `${entry.row.label} new comment unread`.toLowerCase().includes(term.text)),
    );
    return [...matching(here), ...unreadMatches, ...hits, ...matching([...general, ...goTo])];
  }, [
    context,
    recent,
    unreadRows,
    terms,
    found,
    foundTerms,
    navigate,
    openCapture,
    resolved,
    preference,
    setPreference,
    setHelpOpen,
    signOut,
  ]);

  const groups = useMemo<PaletteGroup[]>(() => {
    const result: PaletteGroup[] = [];
    for (const entry of entries) {
      const label = entry.group;
      const last = result[result.length - 1];
      if (last && last.label === label) last.rows.push(entry.row);
      else result.push({ id: `${result.length}`, label, rows: [entry.row] });
    }
    return result;
  }, [entries]);

  const active = entries.find((entry) => entry.id === activeId) ?? entries[0];
  const move = (by: number) => {
    if (!entries.length) return;
    const index = active ? entries.indexOf(active) : 0;
    setActiveId(entries[(index + by + entries.length) % entries.length]?.id ?? null);
  };
  const run = (entry: Entry | undefined) => entry && choose(entry.run);

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    const combo = comboOf(event.nativeEvent);
    const act = (fn: () => void) => {
      event.preventDefault();
      fn();
    };
    if (isShortcut("paletteNext", combo)) act(() => move(1));
    else if (isShortcut("palettePrevious", combo)) act(() => move(-1));
    else if (isShortcut("paletteRun", combo)) act(() => run(active));
    else if (isShortcut("paletteClose", combo) || isShortcut("palette", combo)) act(close);
  }

  const failed = results.isError && terms.length > 0;
  return (
    <PaletteSurface
      query={query}
      onQueryChange={(next) => {
        setQuery(next);
        setActiveId(null);
      }}
      groups={groups}
      activeId={active?.id}
      onActiveChange={setActiveId}
      onKeyDown={onKeyDown}
      onRun={(id) => run(entries.find((entry) => entry.id === id))}
      pending={waiting}
      stale={waiting && !!found}
      empty={
        failed
          ? { title: "Can't reach the pot", text: "Actions still work. Results come back with the connection." }
          : {
              title: "Nothing in the pot",
              text: "No idea, build, attempt or action goes by that name. Try fewer words.",
            }
      }
      hints={[
        { keys: ["↑", "↓"], label: "Move" },
        { keys: caps("paletteRun") ?? [], label: "Open" },
        { keys: caps("paletteClose") ?? [], label: "Close" },
      ]}
    />
  );
}

type Navigate = ReturnType<typeof useNavigate>;

function unreadEntry(item: ItemView, count: number, navigate: Navigate): Entry {
  const id = `unread-${item.id}`;
  const isIdea = item.stage === "idea";
  const name = itemName(item, isIdea ? "idea" : "build");
  const cover = item.photos[0];
  return {
    id,
    group: "New comments",
    run: () =>
      void navigate(
        isIdea
          ? { to: "/ideas/$ideaId", params: { ideaId: item.id }, search: { thread: 1 } as never }
          : { to: "/builds/$buildId", params: { buildId: item.id }, search: { thread: 1 } as never },
      ),
    row: {
      id,
      label: name,
      title: name,
      subtitle: `${count === 1 ? "1 new comment" : `${count} new comments`} · ${isIdea ? "Idea" : "Build"}`,
      photo: cover ? { src: photoSrc(cover.id, "thumb"), color: cover.color || undefined } : null,
      icon: CommentIcon,
    },
  };
}

function recentEntry(item: RecentItem, navigate: Navigate): Entry {
  const id = `recent-${item.id}`;
  return {
    id,
    group: "Recent",
    run: () =>
      void navigate(
        item.kind === "idea"
          ? { to: "/ideas/$ideaId", params: { ideaId: item.id } }
          : { to: "/builds/$buildId", params: { buildId: item.id } },
      ),
    row: {
      id,
      label: item.title,
      title: item.title,
      subtitle: item.kind === "idea" ? "Idea" : "Build",
      photo: item.photo ? { src: photoSrc(item.photo.id, "thumb"), color: item.photo.color || undefined } : null,
      icon: item.kind === "idea" ? IdeasIcon : BuildsIcon,
    },
  };
}

const stageWords = { idea: "Idea", building: "On the bed", done: "Done", shelved: "Shelved" } as const;

function itemEntry(hit: ItemHit, group: string, terms: ReturnType<typeof searchTerms>, navigate: Navigate): Entry {
  const id = `item-${hit.item.id}`;
  const name = itemName(hit.item, hit.item.stage === "idea" ? "idea" : "build");
  const isIdea = hit.item.stage === "idea";
  const meta: ReactNode = isIdea
    ? `Idea · captured ${inlineTime(hit.item.createdAt)}`
    : `${stageWords[hit.item.stage]}${hit.attempts ? ` · ${hit.attempts} ${hit.attempts === 1 ? "attempt" : "attempts"}` : ""}`;
  return {
    id,
    group,
    run: () => void navigate(itemLink(hit)),
    row: {
      id,
      label: name,
      title: <Highlight text={name} terms={terms} />,
      subtitle: meta,
      photo: hit.photo ? { src: photoSrc(hit.photo.id, "thumb"), color: hit.photo.color || undefined } : null,
      icon: isIdea ? IdeasIcon : BuildsIcon,
      trailing: !isIdea && hit.lastOutcome ? <OutcomeChip outcome={hit.lastOutcome} /> : undefined,
    },
  };
}

function attemptEntry(hit: AttemptHit, terms: ReturnType<typeof searchTerms>, navigate: Navigate): Entry {
  const id = `attempt-${hit.attempt.id}`;
  const name = itemName(hit.item, "build");
  return {
    id,
    group: "Attempts",
    run: () => void navigate(attemptLink(hit)),
    row: {
      id,
      label: `${name}, attempt ${hit.number}`,
      title: <Highlight text={name} terms={terms} />,
      subtitle: `Attempt ${hit.number} · ${relativeTime(hit.attempt.printedAt)}`,
      photo: hit.photo ? { src: photoSrc(hit.photo.id, "thumb"), color: hit.photo.color || undefined } : null,
      icon: BuildsIcon,
      trailing: <OutcomeChip outcome={hit.attempt.outcome} />,
    },
  };
}
