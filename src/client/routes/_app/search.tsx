import type { AttemptHit, FixHit, ItemHit, Recipe, Spool, Twist } from "@shared/api";
import { tagLabel } from "@shared/attempts";
import { isFailure } from "@shared/fixes";
import { searchTerms } from "@shared/search";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, type LinkProps, useNavigate } from "@tanstack/react-router";
import { lazy, type ReactNode, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { EmptyPot } from "@/components/illustrations/EmptyPot";
import { Filters } from "@/components/journal/Filters";
import { LazyRecipeSheet } from "@/components/recipes/LazyRecipeSheet";
import { AttemptResult, attemptLink, ItemResult, itemLink } from "@/components/search/Results";
import { PageHeader } from "@/components/shell/PageHeader";
import { Button } from "@/components/ui/Button";
import { ToggleChip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { TextField } from "@/components/ui/Field";
import { ChipRow } from "@/components/ui/FilterChips";
import { ExpandIcon, RecentIcon, SearchIcon, TagIcon } from "@/components/ui/icons";
import { Kbd } from "@/components/ui/Kbd";
import { Overline } from "@/components/ui/Overline";
import { RowSkeleton } from "@/components/ui/Skeleton";
import { useTagOptions } from "@/lib/builds";
import { cn } from "@/lib/cn";
import { useHotkeys } from "@/lib/hotkeys";
import { type Filters as FilterValues, facetsQuery, filterParams, hasFilters, readFilters } from "@/lib/journal";
import { keyboardProxy } from "@/lib/keyboard-proxy";
import { peopleQuery } from "@/lib/queries";
import { forgetSearches, recentSearches, rememberSearch, SEARCH_BOX_ID, searchQuery } from "@/lib/search";

/** Recipe results are drawn only when the search found one. */
const RecipeResult = lazy(() => import("@/components/search/RecipeResult").then((m) => ({ default: m.RecipeResult })));

/** What only some answers need (a spool, a mended typo, "Start again" on one that worked) loads when one appears. */
const Extra = lazy(() => import("@/components/search/Extra"));
/** The builds touched lately, under the suggestions: its code and photos come after the screen has drawn. */
const Lately = lazy(() => import("@/components/search/Lately"));
// The empty notebook's drawing (a long path): only a brand-new notebook shows it, so it isn't in Search's first load.
const NoodleSearch = lazy(() =>
  import("@/components/illustrations/NoodleSearch").then((m) => ({ default: m.NoodleSearch })),
);

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
  | { kind: "fix"; hit: FixHit; link: LinkProps }
  | { kind: "item"; hit: ItemHit; link: LinkProps }
  | { kind: "attempt"; hit: AttemptHit; link: LinkProps }
  | { kind: "recipe"; hit: Recipe }
  | { kind: "twist"; hit: Twist; link: LinkProps }
  | { kind: "spool"; hit: Spool; link: LinkProps };

/** A group of results under its caption. `total` is how many there are when only some are shown. */
interface Group {
  label: string;
  tone?: "basil";
  rows: Result[];
  total?: number;
}

/** Failures shown under what fixed them before "Show all". */
const FAILURES_FOLDED = 3;

/** An attempt that worked: the answer to "what worked". */
const didWork = (r: Result): r is Extract<Result, { kind: "attempt" }> =>
  r.kind === "attempt" && r.hit.attempt.outcome === "success";

function Search() {
  const { q = "", ...filters } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const inputRef = useRef<HTMLInputElement>(null);

  // What's in the box answers at once; the URL (and so the search) follows a beat later.
  // Opened from the header's search on a phone, the keyboard came up on a stand-in inside the tap
  // (lib/keyboard-proxy.ts): what was typed there while this screen loaded starts the box.
  const [text, setText] = useState(() => q || keyboardProxy()?.value || "");
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
    ...searchQuery(q.trim(), filterParams(filters, personId), true),
    enabled: searching && (!filters.person || !!people),
  });
  const shown = searching ? results.data : undefined;
  // What the server made of the question (filler dropped, typos mended, synonyms added) is what gets marked.
  const shownTerms = useMemo(() => shown?.terms ?? searchTerms(shown?.q ?? ""), [shown?.terms, shown?.q]);

  // A problem's failures fold to a few under what fixed it; "Show all" opens them, for this search only.
  const searchKey = `${q}|${JSON.stringify(filters)}`;
  const [allFailuresFor, setAllFailuresFor] = useState<string | null>(null);
  const allFailures = allFailuresFor === searchKey;

  // In the order they are drawn, so the arrow keys follow the page.
  const groups = useMemo<Group[]>(() => {
    if (!shown) return [];
    const fixes = shown.fixes ?? [];
    const fixed = new Set(fixes.map((fix) => fix.attempt.id));
    // What fixed a problem is said once, there; what worked leads the other attempts.
    const attempts = shown.attempts
      .filter((hit) => !fixed.has(hit.attempt.id))
      .map((hit) => ({ kind: "attempt" as const, hit, link: attemptLink(hit) }));
    // Under what fixed it, the failures the words found are the times it happened.
    const failures = fixes.length ? attempts.filter((r) => isFailure(r.hit.attempt.outcome)) : [];
    return [
      {
        label: "What fixed it",
        tone: "basil",
        rows: fixes.map((hit) => ({ kind: "fix" as const, hit, link: attemptLink(hit) })),
      },
      { label: "Recipes", rows: shown.recipes.map((hit) => ({ kind: "recipe" as const, hit })) },
      {
        label: "Twists",
        rows: (shown.twists ?? []).map((hit) => ({
          kind: "twist" as const,
          hit,
          link: { to: "/twists/$twistId", params: { twistId: hit.id } } as LinkProps,
        })),
      },
      { label: "What worked", tone: "basil", rows: attempts.filter(didWork) },
      {
        label: "Builds",
        rows: shown.builds.map((hit) => ({ kind: "item" as const, hit, link: itemLink(hit) })),
      },
      {
        label: "Times it happened",
        rows: allFailures ? failures : failures.slice(0, FAILURES_FOLDED),
        total: failures.length,
      },
      { label: "Attempts", rows: attempts.filter((r) => !didWork(r) && !failures.includes(r)) },
      { label: "Ideas", rows: shown.ideas.map((hit) => ({ kind: "item" as const, hit, link: itemLink(hit) })) },
      {
        label: "Spools",
        rows: (shown.spools ?? []).map((hit) => ({
          kind: "spool" as const,
          hit,
          link: { to: "/pantry/$spoolId", params: { spoolId: hit.id } } as LinkProps,
        })),
      },
    ];
  }, [shown, allFailures]);
  const list = useMemo(() => groups.flatMap((group) => group.rows), [groups]);

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

  const total = groups.reduce((sum, group) => sum + (group.total ?? group.rows.length), 0);
  // The words the closest search ran on (filler dropped, no synonyms: the server lists them): one tap searches for just one.
  const typedWords = shown?.closest ?? [];
  let index = -1;
  const row = (result: Result) => {
    index += 1;
    const i = index;
    const common = {
      terms: shownTerms,
      selected: active === i,
      // Only a mouse moves the highlight: a finger landing on a result (to scroll) must not.
      onHover: (event?: { pointerType?: string }) => {
        if (event?.pointerType && event.pointerType !== "mouse") return;
        setActive(i);
      },
      onOpen: remember,
      ref: (el: HTMLElement | null) => {
        refs.current[i] = el;
      },
    };
    return (
      <li
        key={
          result.kind === "attempt" || result.kind === "fix"
            ? result.hit.attempt.id
            : result.kind === "recipe" || result.kind === "spool" || result.kind === "twist"
              ? result.hit.id
              : result.hit.item.id
        }
        className="list-none"
      >
        {result.kind === "fix" ? (
          <Suspense fallback={<RowSkeleton />}>
            <Extra
              part="fix"
              innerRef={common.ref}
              fix={result.hit}
              terms={common.terms}
              selected={common.selected}
              onHover={common.onHover}
              onOpen={common.onOpen}
            />
          </Suspense>
        ) : result.kind === "attempt" ? (
          <AttemptResult
            hit={result.hit}
            {...common}
            action={
              didWork(result) && (
                <Suspense fallback={null}>
                  <Extra part="start" hit={result.hit} onStart={common.onOpen} />
                </Suspense>
              )
            }
          />
        ) : result.kind === "spool" ? (
          <Suspense fallback={<RowSkeleton />}>
            <Extra
              part="spool"
              innerRef={common.ref}
              spool={result.hit}
              terms={common.terms}
              selected={common.selected}
              onHover={common.onHover}
              onOpen={common.onOpen}
            />
          </Suspense>
        ) : result.kind === "twist" ? (
          <Suspense fallback={<RowSkeleton />}>
            <Extra
              part="twist"
              innerRef={common.ref}
              twist={result.hit}
              terms={common.terms}
              selected={common.selected}
              onHover={common.onHover}
              onOpen={common.onOpen}
            />
          </Suspense>
        ) : result.kind === "recipe" ? (
          <Suspense fallback={<RowSkeleton />}>
            <RecipeResult
              ref={common.ref}
              recipe={result.hit}
              terms={common.terms}
              selected={common.selected}
              onHover={common.onHover}
              onOpen={() => {
                common.onOpen();
                setOpenRecipe(result.hit.id);
              }}
            />
          </Suspense>
        ) : (
          <ItemResult hit={result.hit} {...common} />
        )}
      </li>
    );
  };
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
              {shown && (shown.corrected || shown.when || shown.intent === "worked") && (
                <Suspense fallback={null}>
                  <Extra part="understood" shown={shown} />
                </Suspense>
              )}
              {shown?.closest && typedWords.length > 1 && (
                <div className="flex flex-col gap-3">
                  <p className="text-body text-ink-soft">
                    {typedWords.length === 2 ? "Nothing has both." : "Nothing has all of them."} Closest first:
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {typedWords.map((word) => (
                      <ToggleChip key={word} icon={SearchIcon} onClick={() => pick(word)}>
                        {word}
                      </ToggleChip>
                    ))}
                  </div>
                </div>
              )}
              {!shown ? (
                <div aria-hidden>
                  <RowSkeleton />
                  <RowSkeleton />
                  <RowSkeleton />
                </div>
              ) : total === 0 ? (
                <EmptyState illustration={<EmptyPot />} title="Not a single strand">
                  {terms.length
                    ? "Nothing matches those words. Try the start of one, or another word."
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
                    ({ label, tone, rows, total: all = rows.length }) =>
                      rows.length > 0 && (
                        <section key={label} aria-label={label}>
                          <Overline as="h2" count={all} tone={tone ?? "faint"} className="mb-2 block">
                            {label}
                          </Overline>
                          <ol className="-mx-2 flex flex-col gap-1">{rows.map(row)}</ol>
                          {all > rows.length && (
                            <Button
                              variant="quiet"
                              size="sm"
                              icon={ExpandIcon}
                              className="mt-1 -ml-2"
                              onClick={() => {
                                // The button goes: the first row it brings in takes the focus, so the keyboard keeps its place.
                                const next = list.indexOf(rows[rows.length - 1] as Result) + 1;
                                setAllFailuresFor(searchKey);
                                requestAnimationFrame(() => refs.current[next]?.focus());
                              }}
                            >
                              Show all {all}
                            </Button>
                          )}
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
      <EmptyState
        illustration={
          // Its own size held while it arrives (precached), inside the empty state's own fade-in.
          <Suspense fallback={<div className="aspect-4/3 w-40" />}>
            <NoodleSearch />
          </Suspense>
        }
        title="Nothing to untangle yet"
      >
        Once there are ideas and prints, one search finds them all: titles, notes, filaments and settings.
      </EmptyState>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <p className="text-small text-ink-faint -mb-2 max-md:order-first">
        Ideas, builds and every attempt, by any word you remember.
      </p>
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
      {tags.length > 0 && (
        <SuggestionGroup title="Often tagged">
          {tags.map((tag) => {
            const label = tagLabel(tag.kind, tag.slug, tag.kind === "failure" ? failureOptions : successOptions);
            return (
              <ToggleChip key={`${tag.kind}-${tag.slug}`} selected={false} icon={TagIcon} onClick={() => onPick(label)}>
                {label}
              </ToggleChip>
            );
          })}
        </SuggestionGroup>
      )}
      {materials.length > 0 && (
        <SuggestionGroup title="Materials">
          {materials.map((material) => (
            <ToggleChip key={material.value} selected={false} onClick={() => onFilter({ material: material.value })}>
              {material.value}
            </ToggleChip>
          ))}
        </SuggestionGroup>
      )}
      {/* On a phone the strip leads (the tags and materials would push it under the tab bar), and its room is held while its
          code arrives so nothing below it jumps; from md it sits last. */}
      <div className="empty:hidden max-md:order-first">
        <Suspense fallback={<div className="h-52 md:hidden" />}>
          <Lately />
        </Suspense>
      </div>
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
      {/* Wrapped, not scrolled: what is suggested should be seen at once, not found by swiping. */}
      <ChipRow label={title} wrap>
        {children}
      </ChipRow>
    </section>
  );
}
