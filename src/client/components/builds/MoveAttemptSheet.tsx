import { asksWhichBuild } from "@shared/attempts";
import { readableTitle } from "@shared/print-match";
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
import { type AttemptView, type ItemView, useBuilds, useIdeas } from "@/lib/items";
import { type MoveTarget, offerLines, suggestionsQuery, useMoveAttempt } from "@/lib/print-moves";
import { itemName } from "@/lib/recent";
import { useIsDesktop } from "@/lib/use-media-query";
import { BuildMeta, pictureOf, picturesApart } from "./BuildPick";

interface MoveAttemptSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The build the attempt is in now. */
  item: ItemView;
  attempt: AttemptView;
  /** The builds the printer's question offered and someone passed over ("Another build"): not among the guesses. */
  notThis?: readonly string[];
  /** Follows the print to the build it went to (the attempt's sheet). */
  follow?: (toId: string) => void;
}

const nameOf = (build: ItemView) => itemName(build, build.stage === "idea" ? "idea" : "build");

/**
 * "Which build is this?" (the printer's question for a print it filed in its own build) and "Move attempt N" (any
 * attempt, any time): the builds the app thinks it belongs to first (the matcher's order; the one the question offered,
 * when someone said "Another build", drops to its place in the list); then the builds in progress, the last touched first; then "Its own
 * build", within a thumb's reach; last, done and shelved, a step quieter. A search field narrows all of it and finds
 * ideas too: on top and focused on desktop, at the sheet's foot on phones, where the thumb is and the keyboard lifts
 * it. Enter takes the first row. A tap moves at once; the toast offers Undo.
 */
export function MoveAttemptSheet({ open, onOpenChange, item, attempt, notThis, follow }: MoveAttemptSheetProps) {
  const isDesktop = useIsDesktop();
  const { items: builds } = useBuilds();
  const { items: ideas } = useIdeas();
  const [search, setSearch] = useState("");
  const { data: suggestions } = useQuery({ ...suggestionsQuery(attempt.id), enabled: open });
  const print = attempt.print;
  const asking = asksWhichBuild(item, attempt);
  // The print went into this build by a match: "its own build" brings back the one the printer made.
  const ownElsewhere = !!print && print.ownItemId !== item.id;

  const { suggested, active, finished, foundIdeas } = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matches = (build: ItemView) =>
      !query || `${nameOf(build)} ${build.forWhom ?? ""} ${build.note}`.toLowerCase().includes(query);
    const byId = new Map([...builds, ...ideas].map((one) => [one.id, one]));
    const guessed = (suggestions ?? []).flatMap((one) => {
      const found = byId.get(one.itemId);
      return found && found.id !== item.id && !notThis?.includes(found.id) && !found.pending
        ? [{ build: found, reasons: one.reasons }]
        : [];
    });
    const offered = new Set(guessed.map((one) => one.build.id));
    const ready = builds.filter(
      (build) => !build.pending && build.id !== item.id && !offered.has(build.id) && matches(build),
    );
    // The last touched first: the build being worked on is the likeliest home, more than the one on the bed.
    const byRecent = (a: ItemView, b: ItemView) => b.updatedAt - a.updatedAt;
    return {
      suggested: guessed.filter((one) => matches(one.build)),
      active: ready.filter((build) => build.stage === "building").sort(byRecent),
      finished: ready.filter((build) => build.stage !== "building").sort(byRecent),
      // Ideas only by name: a print can start one, but the list would be long to scroll.
      foundIdeas: query
        ? ideas.filter((idea) => !idea.pending && !offered.has(idea.id) && matches(idea)).sort(byRecent)
        : [],
    };
  }, [builds, ideas, suggestions, item.id, search, notThis]);

  function close(next: boolean) {
    onOpenChange(next);
    // After the closing animation, so the list doesn't change under the sheet as it leaves.
    if (!next) window.setTimeout(() => setSearch(""), 300);
  }

  const moves = useMoveAttempt(item, attempt, follow);

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

  const empty = !suggested.length && !active.length && !finished.length && !foundIdeas.length;
  const first = suggested[0]?.build ?? active[0] ?? foundIdeas[0] ?? finished[0];
  // While searching on desktop, the row Enter takes is marked as the one in hand.
  const enterTakes = (build: ItemView) => isDesktop && !!search.trim() && build.id === first?.id;
  const searchField = (
    <TextField
      aria-label="Search builds"
      placeholder="Search builds and ideas"
      type="search"
      enterKeyHint="go"
      icon={SearchIcon}
      size="sm"
      // On desktop the field is where typing starts; a phone's keyboard waits for a tap, so the list stays in view.
      autoFocus={isDesktop}
      value={search}
      onChange={(event) => setSearch(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter" && first) {
          event.preventDefault();
          moveTo({ item: first });
        }
      }}
      className={isDesktop ? "mb-4" : "flex-1"}
    />
  );
  const { shared, sameFile, lines, names } = offerLines(suggested);
  const pictures = picturesApart(
    suggested.map((one) => one.build),
    sameFile,
  );

  // "Its own build": for the printer's question, keeping it where it is, right under the guesses (in the thumb's reach
  // on a phone, before the long list of builds); for any other attempt, after the builds in progress.
  const ownRow = asking ? (
    <PickRow glyph={{ icon: BuildsIcon }} title="Its own build" meta={`Keep it in ${nameOf(item)}`} onSelect={keep} />
  ) : (
    <PickRow
      glyph={{ icon: BuildsIcon }}
      title="Its own build"
      meta={
        ownElsewhere ? `The one the printer made: ${print?.name ?? "untitled"}` : "A new build, named after its file"
      }
      onSelect={() =>
        moveTo({
          newBuild: { title: ownElsewhere ? null : attempt.file ? readableTitle(attempt.file.name) : null },
        })
      }
    />
  );

  return (
    <Sheet
      open={open}
      onOpenChange={close}
      title={asking ? "Which build is this?" : `Move attempt ${attempt.number}`}
      description={description}
      tall
      // On a phone the field sits at the sheet's foot, in the thumb's reach, and rides up on the keyboard.
      footer={isDesktop ? undefined : searchField}
    >
      {isDesktop && searchField}
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
                  photo={pictures[index]}
                  glyph={{ icon: build.stage === "idea" ? IdeasIcon : BuildsIcon }}
                  title={nameOf(build)}
                  mark={build.stage === "idea" ? <Chip>Idea</Chip> : undefined}
                  meta={<KeepNames text={lines[index] ?? ""} names={names} />}
                  current={enterTakes(build)}
                  onSelect={() => moveTo({ item: build })}
                />
              ))}
            </div>
          </>
        )}
        {asking && <div className="mb-4">{ownRow}</div>}
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
                meta={<BuildMeta build={build} />}
                current={enterTakes(build)}
                onSelect={() => moveTo({ item: build })}
              />
            ))}
          </>
        )}
        {foundIdeas.length > 0 && (
          <>
            <Overline className={active.length || suggested.length ? "mt-3 mb-1" : "mb-1"} count={foundIdeas.length}>
              Ideas
            </Overline>
            {foundIdeas.map((idea) => (
              <PickRow
                key={idea.id}
                photo={pictureOf(idea)}
                glyph={{ icon: IdeasIcon }}
                title={nameOf(idea)}
                meta={`Saved ${relativeTime(idea.createdAt)}`}
                current={enterTakes(idea)}
                onSelect={() => moveTo({ item: idea })}
              />
            ))}
          </>
        )}
        {empty && search.trim() && <p className="text-body text-ink-soft py-4">Nothing by that name.</p>}
        {!asking && (
          <div className={active.length || suggested.length || foundIdeas.length ? "mt-3" : undefined}>{ownRow}</div>
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
                current={enterTakes(build)}
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
