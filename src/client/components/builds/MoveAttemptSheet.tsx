import { whyWords } from "@shared/print-match";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { TextField } from "@/components/ui/Field";
import { BuildsIcon, IdeasIcon, PlusIcon, SearchIcon } from "@/components/ui/icons";
import { MetaList } from "@/components/ui/MetaList";
import { Overline } from "@/components/ui/Overline";
import { PickRow } from "@/components/ui/PickRow";
import { Sheet } from "@/components/ui/Sheet";
import { SuggestionRow } from "@/components/ui/SuggestionRow";
import { findPrinting } from "@/lib/builds";
import { type AttemptView, type ItemView, useBuilds, useIdeas } from "@/lib/items";
import { type MoveTarget, suggestionsQuery, useMoveAttempt } from "@/lib/print-moves";
import { itemName } from "@/lib/recent";
import { useIsDesktop } from "@/lib/use-media-query";
import { BuildMeta, pictureOf } from "./BuildPick";

interface MoveAttemptSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The build the attempt is in now. */
  item: ItemView;
  attempt: AttemptView;
}

/** A file's name as a build's title: "UOBF-fit-test-ring.gcode.3mf" → "UOBF-fit-test-ring". */
const titleOf = (name: string | undefined) => name?.replace(/\.(gcode\.)?3mf$|\.(gcode|stl)$/i, "").trim() || null;

const nameOf = (build: ItemView) => itemName(build, build.stage === "idea" ? "idea" : "build");

/**
 * "Which build is this?" (the printer's question for a print it filed in a build of its own) and "Move attempt N"
 * (any attempt, any time): the builds the app thinks it belongs to first, each with why, as offers a tap takes; then
 * the builds in progress, the one on the bed first; then done and shelved, a step quieter; last, a new build (for the
 * printer's question: "It's a new build"). Search narrows all of it. A tap moves at once; the toast offers Undo.
 */
export function MoveAttemptSheet({ open, onOpenChange, item, attempt }: MoveAttemptSheetProps) {
  const isDesktop = useIsDesktop();
  const { items: builds } = useBuilds();
  const { items: ideas } = useIdeas();
  const [search, setSearch] = useState("");
  const { data: suggestions } = useQuery({ ...suggestionsQuery(attempt.id), enabled: open });
  const print = attempt.print;
  const asking = !!print?.asking;
  // The print went into this build by a match: "a new build" brings back the one the printer made.
  const ownElsewhere = !!print && print.ownItemId !== item.id;

  const { suggested, active, finished } = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matches = (build: ItemView) =>
      !query || `${nameOf(build)} ${build.forWhom ?? ""} ${build.note}`.toLowerCase().includes(query);
    const byId = new Map([...builds, ...ideas].map((one) => [one.id, one]));
    const suggested = (suggestions ?? []).flatMap((one) => {
      const found = byId.get(one.itemId);
      return found && found.id !== item.id && !found.pending && matches(found)
        ? [{ build: found, reasons: one.reasons }]
        : [];
    });
    const offered = new Set(suggested.map((one) => one.build.id));
    const ready = builds.filter(
      (build) => !build.pending && build.id !== item.id && !offered.has(build.id) && matches(build),
    );
    const bedId = findPrinting(builds)?.item.id;
    const byRecent = (a: ItemView, b: ItemView) => b.updatedAt - a.updatedAt;
    return {
      suggested,
      active: ready
        .filter((build) => build.stage === "building")
        .sort((a, b) => Number(b.id === bedId) - Number(a.id === bedId) || byRecent(a, b)),
      finished: ready.filter((build) => build.stage !== "building").sort(byRecent),
    };
  }, [builds, ideas, suggestions, item.id, search]);

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
      The printer calls it <span className="text-ink-soft font-medium break-words">{print.name}</span>. Its photos, note
      and outcome go with it.
    </>
  ) : (
    "Its photos, note and outcome go with it. You can undo it."
  );

  const empty = !suggested.length && !active.length && !finished.length;

  return (
    <Sheet
      open={open}
      onOpenChange={close}
      title={asking ? "Which build is this?" : `Move attempt ${attempt.number}`}
      description={description}
      tall
    >
      <TextField
        aria-label="Search builds"
        placeholder="Search builds"
        type="search"
        icon={SearchIcon}
        size="sm"
        autoFocus={isDesktop}
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
      <div className="flex flex-col">
        {suggested.length > 0 && (
          <>
            <Overline className="mb-2">{suggested.length === 1 ? "Most likely" : "Most likely first"}</Overline>
            <div className="mb-5 flex flex-col gap-2">
              {suggested.map(({ build, reasons }) => (
                <SuggestionRow
                  key={build.id}
                  photo={pictureOf(build)}
                  glyph={build.stage === "idea" ? IdeasIcon : BuildsIcon}
                  title={nameOf(build)}
                  why={whyWords(reasons)}
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
                  </MetaList>
                }
                onSelect={() => moveTo({ item: build })}
              />
            ))}
          </>
        )}
        {empty && search.trim() && <p className="text-body text-ink-soft py-4">No build by that name.</p>}
        <Overline className="mt-5 mb-1">Or</Overline>
        {asking ? (
          <PickRow
            glyph={{ icon: PlusIcon }}
            title="It's a new build"
            meta={`Keep it as ${nameOf(item)}`}
            onSelect={keep}
          />
        ) : (
          <PickRow
            glyph={{ icon: PlusIcon }}
            title={ownElsewhere ? "Its own build" : "A new build"}
            meta={
              ownElsewhere
                ? `As the printer named it: ${print?.name ?? "untitled"}`
                : "Just for this print, named after its file"
            }
            onSelect={() => moveTo({ newBuild: { title: ownElsewhere ? null : titleOf(attempt.file?.name) } })}
          />
        )}
      </div>
    </Sheet>
  );
}
