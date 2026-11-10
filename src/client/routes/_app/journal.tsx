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
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { EmptyPot, OpenNotebook } from "@/components/illustrations";
import { Filters } from "@/components/journal/Filters";
import { entryLink, JournalEntry } from "@/components/journal/JournalEntry";
import { PageHeader } from "@/components/shell/PageHeader";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Kbd } from "@/components/ui/Kbd";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/cn";
import { useHotkeys } from "@/lib/hotkeys";
import {
  type Filters as FilterValues,
  filterParams,
  hasFilters,
  journalQuery,
  readFilters,
  summaryQuery,
} from "@/lib/journal";
import { peopleQuery } from "@/lib/queries";

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
  const months = useMemo(() => groupJournal(entries), [entries]);
  const filtered = hasFilters(filters);

  // J and K walk through the entries, Enter opens one (desktop).
  const [selected, setSelected] = useState<string | null>(null);
  const refs = useRef(new Map<string, HTMLAnchorElement>());
  const move = (by: number) => {
    const index = entries.findIndex((entry) => entry.key === selected);
    const next =
      entries[index === -1 ? (by > 0 ? 0 : entries.length - 1) : Math.max(0, Math.min(entries.length - 1, index + by))];
    if (!next) return;
    setSelected(next.key);
    refs.current.get(next.key)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
  const open = () => {
    const entry = entries.find((e) => e.key === selected);
    const item = entry && items.get(entry.itemId);
    if (entry && item) void navigate(entryLink(entry, item));
  };
  useHotkeys({
    journalNext: () => move(1),
    journalPrevious: () => move(-1),
    journalOpen: selected ? open : undefined,
    journalClear: selected ? () => setSelected(null) : undefined,
  });

  // The next page loads before the end comes into view.
  const sentinel = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  useEffect(() => {
    const element = sentinel.current;
    if (!element || !hasNextPage) return;
    const observer = new IntersectionObserver(
      ([first]) => {
        if (first?.isIntersecting && !isFetchingNextPage) void fetchNextPage();
      },
      { rootMargin: "1200px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const loading = query.isPending;
  const nothingAtAll = !loading && !entries.length && !filtered;

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
      {nothingAtAll ? (
        <EmptyState className="py-10 md:py-20" illustration={<OpenNotebook />} title="A clean notebook">
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
                {months.map((month, index) => (
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
                <div ref={sentinel} aria-hidden />
                {isFetchingNextPage ? (
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
      )}
    </>
  );
}

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
    <section aria-label={monthLabel(month.start)} className="render-lazy flex flex-col gap-7 md:gap-8">
      <header className={cn("flex flex-col gap-1", !first && "pt-4 md:pt-6")}>
        <h2 className="text-caption text-ink-faint font-sans font-semibold tracking-wider uppercase">
          {monthLabel(month.start)}
          {current && " so far"}
        </h2>
        {line === null ? (
          <Skeleton className="h-6 w-64 max-w-full" />
        ) : (
          line && <p className="font-display text-title text-ink-soft">{line}</p>
        )}
      </header>
      {month.groups.map((group) => (
        <Group key={group.key} group={group} items={items} people={people} selected={selected} refs={refs} />
      ))}
    </section>
  );
}

function Group({
  group,
  items,
  people,
  selected,
  refs,
}: Omit<MonthProps, "month" | "first"> & { group: JournalGroup<Entry> }) {
  return (
    <section aria-label={group.kind === "day" ? dayLabel(group.start) : weekLabel(group.start, group.end)}>
      {group.kind === "day" ? (
        <h3 className="text-title text-ink mb-3.5 flex items-baseline gap-2.5 md:mb-4">
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
                selected={selected === entry.key}
                when={group.kind === "day" ? "time" : "date"}
              />
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function FilteredEmpty({ filters, onClear }: { filters: FilterValues; onClear: () => void }) {
  const failures = filters.outcome === "failures" || filters.outcome === "failed";
  return (
    <EmptyState
      className="py-10 md:py-16"
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
