import type { JournalEntry as Entry, Item, Person } from "@shared/api";
import {
  dayLabel,
  groupJournal,
  type JournalGroup,
  type JournalMonth,
  monthLabel,
  shortDate,
  summaryLine,
  weekLabel,
} from "@shared/journal";
import { localDay } from "@shared/today";
import { mondayOfDay, weekRangeLabel } from "@shared/week";
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { type ComponentType, lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { EmptyPot } from "@/components/illustrations/EmptyPot";
import { OpenNotebook } from "@/components/illustrations/OpenNotebook";
import { Filters } from "@/components/journal/Filters";
import { entryLink, JournalEntry } from "@/components/journal/JournalEntry";
import { PageHeader } from "@/components/shell/PageHeader";
import { Since } from "@/components/today/Since";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ArrowRightIcon } from "@/components/ui/icons";
import { Kbd } from "@/components/ui/Kbd";
import { Overline } from "@/components/ui/Overline";
import { Skeleton } from "@/components/ui/Skeleton";
import { useVia } from "@/lib/agents";
import { printingAttempts } from "@/lib/builds";
import { cn } from "@/lib/cn";
import { useOnline } from "@/lib/connection";
import { useHotkeys } from "@/lib/hotkeys";
import { useBuilds } from "@/lib/items";
import {
  type Filters as FilterValues,
  filterParams,
  hasFilters,
  journalQuery,
  readFilters,
  summaryQuery,
} from "@/lib/journal";
import { scrollBehavior } from "@/lib/motion";
import { peopleQuery } from "@/lib/queries";
import { useAfterPaint, useIsDesktop } from "@/lib/use-media-query";

// Phones only, and the print card with its motion and sheets is heavy: off the first load. A phone asks for it as soon as
// this screen's code runs, and the notebook under it waits for it (see Journal), so Now never arrives late and pushes the
// page down. Once it is here, a visit draws it at once instead of suspending for a moment.
let NowLoaded: ComponentType | undefined;
const loadNow = () =>
  import("@/components/journal/Now").then((module) => {
    NowLoaded = module.default;
    return module;
  });
if (!window.matchMedia("(min-width: 48rem)").matches) loadNow().catch(() => undefined);
const LazyNow = lazy(loadNow);

export const Route = createFileRoute("/_app/journal")({
  validateSearch: (search: Record<string, unknown>): Omit<FilterValues, "tag"> => {
    const { tag: _, ...filters } = readFilters(search);
    return filters;
  },
  component: Journal,
});

function Journal() {
  const filters = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { data: people } = useQuery(peopleQuery);
  const byId = new Map(people?.map((person) => [person.id, person]));
  const personId = people?.find((person) => person.username === filters.person)?.id;
  const params = filterParams(filters, personId);
  const query = useInfiniteQuery({
    ...journalQuery(params),
    // A person in the URL needs their id first.
    enabled: !filters.person || !!people,
    placeholderData: keepPreviousData,
  });
  const setFilters = (next: FilterValues) => void navigate({ search: next, replace: true });

  const entries = useMemo(() => query.data?.pages.flatMap((page) => page.entries) ?? [], [query.data]);
  const items = useMemo(() => {
    const map = new Map<string, Item>();
    for (const page of query.data?.pages ?? []) for (const item of page.items) map.set(item.id, item);
    return map;
  }, [query.data]);
  const rest = useAfterPaint();
  const filtered = hasFilters(filters);
  const isDesktop = useIsDesktop();
  // Phones: what is happening now, above the notebook (desktop has Today for it).
  const showNow = !filtered && !isDesktop;
  const [Now] = useState(() => NowLoaded ?? LazyNow);

  // Now shows the prints on the bed, so the notebook under it leaves their attempts out until they are logged, as
  // Today leaves out the print it shows on the bed. Either copy saying so counts: the builds Now draws from, or the
  // journal's own (the two refresh apart). Not before the builds are here: Now can't draw a print without them.
  const builds = useBuilds();
  const shown = useMemo(() => {
    if (!showNow || builds.isPending) return entries;
    const onBed = new Set(printingAttempts(builds.items).map(({ attempt }) => attempt.id));
    return entries.filter((entry) => {
      if (!entry.attemptId) return true;
      if (onBed.has(entry.attemptId)) return false;
      const item = items.get(entry.itemId);
      return !(item?.stage === "building" && item.attempts.some((a) => a.id === entry.attemptId && a.outcome === null));
    });
  }, [showNow, entries, items, builds.items, builds.isPending]);
  const months = useMemo(() => groupJournal(shown), [shown]);

  // J and K walk through the entries, Enter opens one (desktop).
  const [selected, setSelected] = useState<string | null>(null);
  const refs = useRef(new Map<string, HTMLAnchorElement>());
  const move = (by: number) => {
    const index = shown.findIndex((entry) => entry.key === selected);
    const next =
      shown[index === -1 ? (by > 0 ? 0 : shown.length - 1) : Math.max(0, Math.min(shown.length - 1, index + by))];
    if (!next) return;
    setSelected(next.key);
    refs.current.get(next.key)?.scrollIntoView({ block: "nearest", behavior: scrollBehavior() });
  };
  const open = () => {
    const entry = shown.find((e) => e.key === selected);
    const item = entry && items.get(entry.itemId);
    if (entry && item) void navigate(entryLink(entry, item));
  };
  useHotkeys({
    journalNext: () => move(1),
    journalPrevious: () => move(-1),
    journalOpen: selected ? open : undefined,
    journalClear: selected ? () => setSelected(null) : undefined,
    journalFailures: () => setFilters({ ...filters, outcome: filters.outcome === "failures" ? undefined : "failures" }),
  });

  // The next page loads before the end comes into view.
  const sentinel = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  useEffect(() => {
    const element = sentinel.current;
    if (!element || !hasNextPage || !rest) return;
    const observer = new IntersectionObserver(
      ([first]) => {
        if (first?.isIntersecting && !isFetchingNextPage) void fetchNextPage();
      },
      { rootMargin: "1200px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, rest]);

  const nothingAtAll = !query.isPending && !entries.length && !filtered;
  // On a phone the notebook also waits for the builds, which Now draws the prints on the bed from (not offline, where
  // they may never come: the notebook then shows every entry).
  const online = useOnline();
  const loading = query.isPending || (showNow && builds.isPending && online);

  const notebook = nothingAtAll ? (
    <EmptyState illustration={<OpenNotebook />} title="A clean notebook">
      Every print lands here, the perfect ones and the spaghetti. Failures are worth writing down too.
    </EmptyState>
  ) : (
    <div className="xl:flex xl:items-start xl:gap-14">
      <div className="min-w-0 flex-1">
        <div className="mb-6 xl:hidden">
          <Filters layout="row" value={filters} onChange={setFilters} />
        </div>
        {loading ? (
          <JournalSkeleton />
        ) : entries.length === 0 ? (
          <FilteredEmpty filters={filters} onClear={() => setFilters({})} />
        ) : (
          <div
            className={cn(
              "duration-fast flex flex-col gap-12 transition-opacity md:gap-14",
              query.isPlaceholderData && "opacity-60",
            )}
          >
            {(rest ? months : months.slice(0, 1)).map((month, index) => (
              <Month
                key={month.key}
                month={month}
                first={index === 0}
                items={items}
                people={byId}
                selected={selected}
                refs={refs.current}
              />
            ))}
            {rest && <div ref={sentinel} aria-hidden />}
            {!rest ? null : isFetchingNextPage ? (
              <JournalSkeleton short />
            ) : (
              !hasNextPage && (
                <p className="text-small text-ink-faint pb-4 text-center">
                  {filtered ? "That's all of them." : "The first page of the notebook. It all started here."}
                </p>
              )
            )}
          </div>
        )}
      </div>
      <aside aria-label="Filters" className="sticky top-10 hidden w-60 shrink-0 xl:block">
        <Filters layout="column" value={filters} onChange={setFilters} />
      </aside>
    </div>
  );

  return (
    <>
      <PageHeader
        title="Journal"
        subtitle="What worked, what failed, and what we learned."
        actions={
          entries.length > 0 && (
            <span className="text-small text-ink-faint flex items-center gap-1.5">
              <Kbd keys={["J"]} />
              <Kbd keys={["K"]} />
              to move, <Kbd keys={["Enter"]} /> to open
            </span>
          )
        }
      />
      {showNow && <Since />}
      {/* Phones: Now and the notebook under it show together, once Now's code and what it draws from are here, with one
          skeleton until then, so nothing is pushed down after it first shows. The notebook keeps its place in the tree
          when a filter hides Now, so the filter row doesn't start over. */}
      {showNow && loading ? (
        <Waiting />
      ) : (
        <Suspense fallback={<Waiting />}>
          {showNow && <Now />}
          {notebook}
        </Suspense>
      )}
    </>
  );
}

/** The Monday (workspace calendar) of the day a group starts on: its start is local time, so read the local calendar day. */
const weekOf = (start: number | undefined) => (start === undefined ? null : mondayOfDay(localDay(start)));

interface MonthProps {
  month: JournalMonth<Entry>;
  first: boolean;
  items: Map<string, Item>;
  people: Map<string, Person>;
  selected: string | null;
  refs: Map<string, HTMLAnchorElement>;
}

/** A month: a quiet heading that sums it up, then its days or weeks. */
function Month({ month, first, items, people, selected, refs }: MonthProps) {
  const now = Date.now();
  const current = now >= month.start && now <= month.end;
  const { data: summary } = useQuery(summaryQuery(month.start, month.end));
  const line = summary ? summaryLine(summary) : null;
  return (
    <section aria-label={monthLabel(month.start)} className="render-lazy -mx-2 flex flex-col gap-7 px-2 md:gap-8">
      <header className={cn("flex flex-col gap-1", !first && "pt-4 md:pt-6")}>
        <div className="flex items-baseline justify-between gap-4">
          <Overline as="h2">
            {monthLabel(month.start)}
            {current && " so far"}
          </Overline>
          {first && line && (
            <Link
              to="/year"
              search={{ year: new Date(month.start).getFullYear() }}
              className="text-small text-ink-faint hover:text-ink focus-ring touch-target relative -my-2 rounded-sm py-2 whitespace-nowrap"
            >
              See the year
            </Link>
          )}
        </div>
        {line === null ? (
          <Skeleton className="h-6 w-64 max-w-full" />
        ) : (
          line && <p className="font-display text-title text-ink-soft">{line}</p>
        )}
      </header>
      {month.groups.map((group, index) => (
        <Group
          key={group.key}
          group={group}
          weekEnds={weekOf(group.start) !== weekOf(month.groups[index + 1]?.start)}
          items={items}
          people={people}
          selected={selected}
          refs={refs}
        />
      ))}
    </section>
  );
}

function Group({
  group,
  weekEnds,
  items,
  people,
  selected,
  refs,
}: Omit<MonthProps, "month" | "first"> & { group: JournalGroup<Entry>; weekEnds: boolean }) {
  const via = useVia();
  return (
    <section aria-label={group.kind === "day" ? dayLabel(group.start) : weekLabel(group.start, group.end)}>
      {group.kind === "day" ? (
        <h3 className="text-body text-ink mb-3 flex items-baseline gap-2.5 font-sans font-semibold md:mb-3.5">
          {dayLabel(group.start)}
          <span className="text-small text-ink-faint font-sans font-medium">{shortDate(group.start)}</span>
        </h3>
      ) : (
        <h3 className="text-small text-ink-faint mb-3 font-sans font-semibold">{weekLabel(group.start, group.end)}</h3>
      )}
      <ol className="flex flex-col gap-3 md:gap-4">
        {group.entries.map((entry) => {
          const item = items.get(entry.itemId);
          if (!item) return null;
          // Who started or finished a build isn't recorded: only attempts and ideas show a person.
          const person = entry.kind === "attempt" || entry.kind === "idea" ? people.get(entry.by) : undefined;
          return (
            <li key={entry.key} className="list-none">
              <JournalEntry
                ref={(el) => {
                  if (el) refs.set(entry.key, el);
                  else refs.delete(entry.key);
                }}
                entry={entry}
                item={item}
                person={person}
                via={via(entry.via)}
                selected={selected === entry.key}
                when={group.kind === "day" ? "time" : "date"}
              />
            </li>
          );
        })}
      </ol>
      {weekEnds && (
        <Link
          to="/week/$monday"
          params={{ monday: weekOf(group.start) ?? "" }}
          className="text-small text-ink-soft hover:text-ink focus-ring touch-target relative mt-1 inline-flex items-center gap-1 rounded-sm py-2 font-medium"
        >
          The week<span className="sr-only"> of {weekRangeLabel(weekOf(group.start) ?? "")}</span>
          <ArrowRightIcon size={14} weight="bold" aria-hidden />
        </Link>
      )}
    </section>
  );
}

function FilteredEmpty({ filters, onClear }: { filters: FilterValues; onClear: () => void }) {
  const failures = filters.outcome === "failures" || filters.outcome === "failed";
  return (
    <EmptyState
      illustration={<EmptyPot />}
      title={failures ? "Not a strand out of place" : "Nothing in this pot"}
      action={
        <Button variant="secondary" onClick={onClear}>
          Clear filters
        </Button>
      }
    >
      {failures
        ? "No failures logged with these filters. When a print goes wrong, log it: it's how the next one goes right."
        : "Nothing in the journal matches these filters yet."}
    </EmptyState>
  );
}

/**
 * The phone's skeleton while Now and the notebook are on their way. It holds four screens of room: a page opened again
 * (a reload, or a phone bringing back an app it had put away) gets its scroll position back while this shows, and
 * would otherwise be cut short at the skeleton's height, landing somewhere in the middle of Now.
 */
function Waiting() {
  return (
    <div className="min-h-[400dvh]">
      <JournalSkeleton />
    </div>
  );
}

function JournalSkeleton({ short = false }: { short?: boolean }) {
  return (
    <div className="flex flex-col gap-4" aria-hidden>
      {!short && <Skeleton className="mb-3 h-6 w-48" />}
      {Array.from({ length: short ? 1 : 3 }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity.
        <div key={index} className="bg-cream shadow-soft flex flex-col gap-3 rounded-lg p-1.5 md:flex-row">
          <Skeleton className="aspect-4/3 rounded-md md:w-2/5" />
          <div className="flex flex-1 flex-col gap-2.5 p-2.5 md:p-4">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-3 w-2/5" />
          </div>
        </div>
      ))}
    </div>
  );
}
