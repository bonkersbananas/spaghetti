import type { AttemptHit, ItemHit, Recipe } from "@shared/api";
import { tagLabel } from "@shared/attempts";
import { searchTerms } from "@shared/search";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, type LinkProps, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { EmptyPot, NoodleSearch } from "@/components/illustrations";
import { Filters } from "@/components/journal/Filters";
import { LazyRecipeSheet } from "@/components/recipes/LazyRecipeSheet";
import { AttemptResult, attemptLink, ItemResult, itemLink, RecipeResult } from "@/components/search/Results";
import { PageHeader } from "@/components/shell/PageHeader";
import { Button } from "@/components/ui/Button";
import { ToggleChip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { TextField } from "@/components/ui/Field";
import { ChipRow } from "@/components/ui/FilterChips";
import { RecentIcon, SearchIcon, TagIcon } from "@/components/ui/icons";
import { Kbd } from "@/components/ui/Kbd";
import { Overline } from "@/components/ui/Overline";
import { RowSkeleton } from "@/components/ui/Skeleton";
import { useTagOptions } from "@/lib/builds";
import { cn } from "@/lib/cn";
import { useHotkeys } from "@/lib/hotkeys";
import { type Filters as FilterValues, facetsQuery, filterParams, hasFilters, readFilters } from "@/lib/journal";
import { peopleQuery } from "@/lib/queries";
import { forgetSearches, recentSearches, rememberSearch, SEARCH_BOX_ID, searchQuery } from "@/lib/search";

type SearchParams = FilterValues & { q?: string };

export const Route = createFileRoute("/_app/search")({
  validateSearch: (search: Record<string, unknown>): SearchParams => {
    const q = typeof search.q === "string" ? search.q.slice(0, 200) : "";
    return { ...(q.trim() ? { q } : {}), ...readFilters(search) };
  },
  component: Search,
});

/** How long typing pauses before the search runs. */
const DEBOUNCE_MS = 140;

type Result =
  | { kind: "item"; hit: ItemHit; link: LinkProps }
  | { kind: "attempt"; hit: AttemptHit; link: LinkProps }
  | { kind: "recipe"; hit: Recipe };

function Search() {
  const { q = "", ...filters } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const inputRef = useRef<HTMLInputElement>(null);

  // What's in the box answers at once; the URL (and so the search) follows a beat later.
  const [text, setText] = useState(q);
  const pushed = useRef(q);
  useEffect(() => {
    if (text === pushed.current) return;
    const timer = setTimeout(() => {
      pushed.current = text;
      void navigate({
        search: (current: SearchParams) => ({ ...current, q: text.trim() ? text : undefined }),
        replace: true,
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, navigate]);
  // Back, forward or a suggestion changed the query: show it in the box.
  useEffect(() => {
    if (q === pushed.current) return;
    pushed.current = q;
    setText(q);
  }, [q]);

  const { data: people } = useQuery(peopleQuery);
  const personId = people?.find((person) => person.username === filters.person)?.id;
  const terms = searchTerms(q);
  const searching = terms.length > 0 || hasFilters(filters);
  const results = useQuery({
    ...searchQuery(q.trim(), filterParams(filters, personId)),
    enabled: searching && (!filters.person || !!people),
  });
  const shown = searching ? results.data : undefined;
  const shownTerms = useMemo(() => searchTerms(shown?.q ?? ""), [shown?.q]);

  const list = useMemo<Result[]>(() => {
    if (!shown) return [];
    return [
      ...shown.recipes.map((hit) => ({ kind: "recipe" as const, hit })),
      ...shown.builds.map((hit) => ({ kind: "item" as const, hit, link: itemLink(hit) })),
      ...shown.attempts.map((hit) => ({ kind: "attempt" as const, hit, link: attemptLink(hit) })),
      ...shown.ideas.map((hit) => ({ kind: "item" as const, hit, link: itemLink(hit) })),
    ];
  }, [shown]);

  // Arrow keys move through the results, from the box or anywhere; Enter opens one.
  const [active, setActive] = useState(-1);
  // biome-ignore lint/correctness/useExhaustiveDependencies: new results start unpicked.
  useEffect(() => setActive(-1), [list]);
  const refs = useRef<Array<HTMLElement | null>>([]);
  const [openRecipe, setOpenRecipe] = useState<string | null>(null);
  const move = (by: number) => {
    if (!list.length) return;
    const next = active === -1 ? (by > 0 ? 0 : list.length - 1) : Math.max(0, Math.min(list.length - 1, active + by));
    setActive(next);
    refs.current[next]?.scrollIntoView({ block: "nearest" });
  };
  const [recent, setRecent] = useState(recentSearches);
  const remember = () => {
    if (q.trim()) setRecent(rememberSearch(q));
  };
  const open = (index = Math.max(0, active)) => {
    const result = list[index];
    if (!result) return;
    remember();
    if (result.kind === "recipe") setOpenRecipe(result.hit.id);
    else void navigate(result.link);
  };
  // "/" (focus the box) is bound once, for the whole app, in the shell.
  useHotkeys({
    searchNext: list.length ? () => move(1) : undefined,
    searchPrevious: list.length ? () => move(-1) : undefined,
    searchOpen: active >= 0 ? () => open() : undefined,
  });

  const setFilters = (next: FilterValues) =>
    void navigate({ search: { ...next, ...(q.trim() ? { q } : {}) }, replace: true });
  const pick = (query: string) => {
    setText(query);
    pushed.current = query;
    void navigate({ search: (current: SearchParams) => ({ ...current, q: query }), replace: true });
    inputRef.current?.focus();
  };

  const total = list.length;
  let index = -1;
  const row = (result: Result) => {
    index += 1;
    const i = index;
    const common = {
      terms: shownTerms,
      selected: active === i,
      onHover: () => setActive(i),
      onOpen: remember,
      ref: (el: HTMLElement | null) => {
        refs.current[i] = el;
      },
    };
    return (
      <li
        key={
          result.kind === "attempt"
            ? result.hit.attempt.id
            : result.kind === "recipe"
              ? result.hit.id
              : result.hit.item.id
        }
        className="list-none"
      >
        {result.kind === "attempt" ? (
          <AttemptResult hit={result.hit} {...common} />
        ) : result.kind === "recipe" ? (
          <RecipeResult
            recipe={result.hit}
            terms={common.terms}
            selected={common.selected}
            onHover={common.onHover}
            onOpen={() => {
              common.onOpen();
              setOpenRecipe(result.hit.id);
            }}
          />
        ) : (
          <ItemResult hit={result.hit} {...common} />
        )}
      </li>
    );
  };
  const groups: Array<[string, Result[]]> = shown
    ? [
        ["Recipes", list.filter((r) => r.kind === "recipe")],
        ["Builds", list.filter((r) => r.kind === "item" && r.hit.item.stage !== "idea")],
        ["Attempts", list.filter((r) => r.kind === "attempt")],
        ["Ideas", list.filter((r) => r.kind === "item" && r.hit.item.stage === "idea")],
      ]
    : [];

  return (
    <>
      <PageHeader
        search={false}
        title="Search"
        subtitle="Find what worked last time."
        actions={
          total > 0 && (
            <span className="text-small text-ink-faint flex items-center gap-1.5">
              <Kbd keys={["↑"]} />
              <Kbd keys={["↓"]} />
              to move, <Kbd keys={["Enter"]} /> to open
            </span>
          )
        }
      />
      <div className="xl:flex xl:items-start xl:gap-14">
        <div className="flex min-w-0 flex-1 flex-col gap-5">
          <TextField
            ref={inputRef}
            id={SEARCH_BOX_ID}
            type="search"
            icon={SearchIcon}
            aria-label="Search"
            placeholder="PETG warping, tugboat, tree supports…"
            enterKeyHint="search"
            autoComplete="off"
            value={text}
            // Opened from the tab bar or with "/": the keyboard comes up, ready to type.
            autoFocus
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                move(event.key === "ArrowDown" ? 1 : -1);
              } else if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                if (list.length) open();
                else event.currentTarget.blur();
              } else if (event.key === "Escape") {
                if (text) {
                  event.preventDefault();
                  setText("");
                } else event.currentTarget.blur();
              }
            }}
          />
          {searching ? (
            <>
              <div className="xl:hidden">
                <Filters layout="row" tags value={filters} onChange={setFilters} />
              </div>
              <p className="sr-only" aria-live="polite">
                {shown ? `${total} ${total === 1 ? "result" : "results"}` : ""}
              </p>
              {!shown ? (
                <div aria-hidden>
                  <RowSkeleton />
                  <RowSkeleton />
                  <RowSkeleton />
                </div>
              ) : total === 0 ? (
                <EmptyState className="py-8 md:py-14" illustration={<EmptyPot />} title="Not a single strand">
                  {terms.length
                    ? "Nothing matches all of those words. Try fewer, or the start of one."
                    : "Nothing matches these filters yet."}
                </EmptyState>
              ) : (
                <div
                  className={cn(
                    "duration-fast flex flex-col gap-7 transition-opacity",
                    results.isPlaceholderData && "opacity-60",
                  )}
                >
                  {groups.map(
                    ([label, rows]) =>
                      rows.length > 0 && (
                        <section key={label} aria-label={label}>
                          <Overline as="h2" count={rows.length} className="mb-2 block">
                            {label}
                          </Overline>
                          <ol className="-mx-2 flex flex-col gap-1">{rows.map(row)}</ol>
                        </section>
                      ),
                  )}
                </div>
              )}
            </>
          ) : (
            <Suggestions
              recent={recent}
              onPick={pick}
              onForget={() => setRecent(forgetSearches())}
              onFilter={setFilters}
            />
          )}
        </div>
        {/* Before a search the suggestions offer the same tags: the column keeps its place, empty. */}
        <aside
          aria-label="Filters"
          aria-hidden={!searching || undefined}
          className={cn("sticky top-10 hidden w-60 shrink-0 xl:block", !searching && "invisible")}
        >
          <Filters layout="column" tags value={filters} onChange={setFilters} />
        </aside>
      </div>
      <LazyRecipeSheet recipeId={openRecipe} onOpenChange={(next) => !next && setOpenRecipe(null)} />
    </>
  );
}

/** Before typing: recent searches on this device, and the tags and materials used most. */
function Suggestions({
  recent,
  onPick,
  onForget,
  onFilter,
}: {
  recent: string[];
  onPick: (query: string) => void;
  onForget: () => void;
  onFilter: (filters: FilterValues) => void;
}) {
  const { data: facets, isPending } = useQuery(facetsQuery);
  const failureOptions = useTagOptions("failure");
  const successOptions = useTagOptions("success");
  const tags = (facets?.tags ?? []).slice(0, 8);
  const materials = (facets?.materials ?? []).slice(0, 4);
  if (isPending && !recent.length) return null;
  if (!recent.length && !tags.length && !materials.length) {
    return (
      <EmptyState className="py-8 md:py-16" illustration={<NoodleSearch />} title="Nothing to untangle yet">
        Once there are ideas and prints, one search finds them all: titles, notes, filaments and settings.
      </EmptyState>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      {recent.length > 0 && (
        <SuggestionGroup
          title="Recent"
          action={
            <Button variant="quiet" size="sm" onClick={onForget}>
              Clear
            </Button>
          }
        >
          {recent.map((query) => (
            <ToggleChip key={query} selected={false} icon={RecentIcon} onClick={() => onPick(query)}>
              {query}
            </ToggleChip>
          ))}
        </SuggestionGroup>
      )}
      {(tags.length > 0 || materials.length > 0) && (
        <SuggestionGroup title="Often tagged">
          {tags.map((tag) => {
            const label = tagLabel(tag.kind, tag.slug, tag.kind === "failure" ? failureOptions : successOptions);
            return (
              <ToggleChip key={`${tag.kind}-${tag.slug}`} selected={false} icon={TagIcon} onClick={() => onPick(label)}>
                {label}
              </ToggleChip>
            );
          })}
          {materials.map((material) => (
            <ToggleChip key={material.value} selected={false} onClick={() => onFilter({ material: material.value })}>
              {material.value}
            </ToggleChip>
          ))}
        </SuggestionGroup>
      )}
    </div>
  );
}

function SuggestionGroup({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-2.5">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <Overline as="h2">{title}</Overline>
        {action}
      </div>
      <ChipRow label={title}>{children}</ChipRow>
    </section>
  );
}
