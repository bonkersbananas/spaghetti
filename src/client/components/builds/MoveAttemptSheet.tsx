import { relativeTime } from "@shared/time";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Chip } from "@/components/ui/Chip";
import { TextField } from "@/components/ui/Field";
import { BuildsIcon, IdeasIcon, SearchIcon } from "@/components/ui/icons";
import { KeepNames, KeptName } from "@/components/ui/KeepNames";
import { MetaList } from "@/components/ui/MetaList";
import { Overline } from "@/components/ui/Overline";
import { PickRow } from "@/components/ui/PickRow";
import { Sheet } from "@/components/ui/Sheet";
import { findPrinting } from "@/lib/builds";
import { type AttemptView, type ItemView, useBuilds, useIdeas } from "@/lib/items";
import { type MoveTarget, offerLines, suggestionsQuery, useMoveAttempt } from "@/lib/print-moves";
import { itemName } from "@/lib/recent";
import { useIsDesktop } from "@/lib/use-media-query";
import { BuildMeta, pictureOf } from "./BuildPick";

interface MoveAttemptSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The build the attempt is in now. */
  item: ItemView;
  attempt: AttemptView;
  /** Opened from the printer's question, whose guesses the card showed already: they are left out here. */
  withoutGuesses?: boolean;
}

/** A file's name as a build's title: "UOBF-fit-test-ring.gcode.3mf" → "UOBF-fit-test-ring". */
const titleOf = (name: string | undefined) => name?.replace(/\.(gcode\.)?3mf$|\.(gcode|stl)$/i, "").trim() || null;

const nameOf = (build: ItemView) => itemName(build, build.stage === "idea" ? "idea" : "build");

/**
 * "Which build is this?" (the printer's question for a print it filed in its own build) and "Move attempt N" (any
 * attempt, any time): the builds the app thinks it belongs to first, unless the card showed them already; then the
 * builds in progress, the last touched first; then "Its own build", within a thumb's reach; last, done and shelved,
 * a step quieter. Search (on desktop, as in "Add to a build…") narrows all of it. A tap moves at once; the toast
 * offers Undo.
 */
export function MoveAttemptSheet({ open, onOpenChange, item, attempt, withoutGuesses }: MoveAttemptSheetProps) {
  const isDesktop = useIsDesktop();
  const { items: builds } = useBuilds();
  const { items: ideas } = useIdeas();
  const [search, setSearch] = useState("");
  const { data: suggestions } = useQuery({ ...suggestionsQuery(attempt.id), enabled: open });
  const print = attempt.print;
  const asking = !!print?.asking;
  // The print went into this build by a match: "its own build" brings back the one the printer made.
  const ownElsewhere = !!print && print.ownItemId !== item.id;

  const { suggested, active, finished } = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matches = (build: ItemView) =>
      !query || `${nameOf(build)} ${build.forWhom ?? ""} ${build.note}`.toLowerCase().includes(query);
    const byId = new Map([...builds, ...ideas].map((one) => [one.id, one]));
    const guessed = (suggestions ?? []).flatMap((one) => {
      const found = byId.get(one.itemId);
      return found && found.id !== item.id && !found.pending ? [{ build: found, reasons: one.reasons }] : [];
    });
    const offered = new Set(guessed.map((one) => one.build.id));
    const ready = builds.filter(
      (build) => !build.pending && build.id !== item.id && !offered.has(build.id) && matches(build),
    );
    // The last touched first: the build being worked on is the likeliest home, more than the one on the bed.
    const byRecent = (a: ItemView, b: ItemView) => b.updatedAt - a.updatedAt;
    return {
      suggested: withoutGuesses ? [] : guessed.filter((one) => matches(one.build)),
      active: ready.filter((build) => build.stage === "building").sort(byRecent),
      finished: ready.filter((build) => build.stage !== "building").sort(byRecent),
    };
  }, [builds, ideas, suggestions, item.id, search, withoutGuesses]);

  const onBed = findPrinting(builds);

  function close(next: boolean) {
    onOpenChange(next);
    // After the closing animation, so the list doesn't change under the sheet as it leaves.
    if (!next) window.setTimeout(() => setSearch(""), 300);
  }

  const moves = useMoveAttempt(item, attempt);

  function moveTo(to: MoveTarget) {
    if (moves.move(to)) close(false);
  }

  function keep() {
    if (moves.keep()) close(false);
  }

  const description = print?.name ? (
    <>
      The printer calls it <KeptName>{print.name}</KeptName>. Its photos, note and outcome go with it.
    </>
  ) : (
    "Its photos, note and outcome go with it. You can undo it."
  );

  const empty = !suggested.length && !active.length && !finished.length;
  const { shared, lines, names } = offerLines(suggested);

  return (
    <Sheet
      open={open}
      onOpenChange={close}
      title={asking ? "Which build is this?" : `Move attempt ${attempt.number}`}
      description={description}
      tall
    >
      {/* Searchable on desktop, as "Add to a build…" is; a phone scrolls a list the thumb can reach. */}
      {isDesktop && (
        <TextField
          aria-label="Search builds"
          placeholder="Search builds"
          type="search"
          icon={SearchIcon}
          size="sm"
          autoFocus
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onKeyDown={(event) => {
            const first = suggested[0]?.build ?? active[0] ?? finished[0];
            if (event.key === "Enter" && first) {
              event.preventDefault();
              moveTo({ item: first });
            }
          }}
          className="mb-4"
        />
      )}
      <div className="flex flex-col">
        {suggested.length > 0 && (
          <>
            <Overline className="mb-1">Most likely</Overline>
            {shared && (
              <p className="text-small text-ink-faint mb-1 text-pretty">
                <KeepNames text={shared} names={names} />
              </p>
            )}
            <div className="mb-4 flex flex-col">
              {suggested.map(({ build }, index) => (
                <PickRow
                  key={build.id}
                  photo={pictureOf(build)}
                  glyph={{ icon: build.stage === "idea" ? IdeasIcon : BuildsIcon }}
                  title={nameOf(build)}
                  mark={build.stage === "idea" ? <Chip>Idea</Chip> : undefined}
                  meta={<KeepNames text={lines[index] ?? ""} names={names} />}
                  onSelect={() => moveTo({ item: build })}
                />
              ))}
            </div>
          </>
        )}
        {active.length > 0 && (
          <>
            <Overline className="mb-1" count={active.length}>
              In progress
            </Overline>
            {active.map((build) => (
              <PickRow
                key={build.id}
                photo={pictureOf(build)}
                glyph={{ icon: BuildsIcon }}
                title={nameOf(build)}
                meta={<BuildMeta build={build} printing={onBed?.item.id === build.id ? onBed.attempt : undefined} />}
                onSelect={() => moveTo({ item: build })}
              />
            ))}
          </>
        )}
        {empty && search.trim() && <p className="text-body text-ink-soft py-4">No build by that name.</p>}
        <div className={active.length || suggested.length ? "mt-3" : undefined}>
          {asking ? (
            <PickRow
              glyph={{ icon: BuildsIcon }}
              title="Its own build"
              meta={`Keep it in ${nameOf(item)}`}
              onSelect={keep}
            />
          ) : (
            <PickRow
              glyph={{ icon: BuildsIcon }}
              title="Its own build"
              meta={
                ownElsewhere
                  ? `The one the printer made: ${print?.name ?? "untitled"}`
                  : "A new build, named after its file"
              }
              onSelect={() => moveTo({ newBuild: { title: ownElsewhere ? null : titleOf(attempt.file?.name) } })}
            />
          )}
        </div>
        {finished.length > 0 && (
          <>
            <Overline className="mt-5 mb-1" count={finished.length}>
              Done and shelved
            </Overline>
            {finished.map((build) => (
              <PickRow
                key={build.id}
                quiet
                photo={pictureOf(build)}
                glyph={{ icon: BuildsIcon }}
                title={nameOf(build)}
                meta={
                  <MetaList>
                    <span>{build.stage === "done" ? "Done" : "Shelved"}</span>
                    <span>{relativeTime(build.finishedAt ?? build.updatedAt)}</span>
                  </MetaList>
                }
                onSelect={() => moveTo({ item: build })}
              />
            ))}
          </>
        )}
      </div>
    </Sheet>
  );
}
