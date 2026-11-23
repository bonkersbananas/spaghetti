import type { AttemptMoved } from "@shared/api";
import { filedWords, namesIn, readableTitle, rowWords, sharedWords } from "@shared/print-match";
import { inlineTime } from "@shared/time";
import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense, useState } from "react";
import { AskLine, AskName } from "@/components/ui/AskLine";
import { Button } from "@/components/ui/Button";
import { MoveIntoIcon, PrinterIcon, SearchIcon } from "@/components/ui/icons";
import { KeepNames, KeptName } from "@/components/ui/KeepNames";
import { MetaList } from "@/components/ui/MetaList";
import { WhyLine } from "@/components/ui/WhyLine";
import { type AttemptView, type ItemView, useBuilds, useIdeas } from "@/lib/items";
import { suggestionsQuery, useMoveAttempt } from "@/lib/print-moves";
import { peopleQuery } from "@/lib/queries";
import { useReadOnly } from "@/lib/read-only";
import { itemName } from "@/lib/recent";
import { useIsDesktop } from "@/lib/use-media-query";
import { useWho } from "@/lib/who";

const MoveAttemptSheet = lazy(() => import("./MoveAttemptSheet").then((m) => ({ default: m.MoveAttemptSheet })));

interface PrintPlaceProps {
  /** The build the attempt is in. */
  item: ItemView;
  attempt: AttemptView;
  /**
   * "card": a print on the bed (Today, Builds, the Journal's Now): the printer's question, or why it is in this build.
   * "entry": an attempt in a build's story: the same, and where it was moved from.
   * "sheet": the attempt's sheet ("How did it go?"): only the printer's question.
   */
  where: "card" | "entry" | "sheet";
  /** Follows the print to the build it went to, whichever way it moved (the attempt's sheet reopens there). */
  follow?: (toId: string) => void;
  className?: string;
}

/**
 * Where a print the printer bridge filed is, and why (decision 0076). A print in its own build asks in one line,
 * "Is this Herb planter?" with Yes and "Another build" (or, when nothing fits, "Which build?"); a print the app
 * filed in a build says why in one quiet line with "Not this build?"; an attempt moved here says from where. Every
 * way to change it opens the same sheet, and every move has an Undo. The card on the bed and the attempt on the build
 * page ask in the same words.
 */
export default function PrintPlace({ item, attempt, where, follow, className }: PrintPlaceProps) {
  const [open, setOpen] = useState(false);
  // The sheet's code comes with the first tap.
  const [asked, setAsked] = useState(false);
  // The builds the question offered and someone passed over ("Another build"): the sheet doesn't lead with them.
  const [passed, setPassed] = useState<readonly string[]>([]);
  const readOnly = useReadOnly(item.pending || attempt.pending);
  const openSheet = (notThis: readonly string[]) => {
    setPassed(notThis);
    setAsked(true);
    setOpen(true);
  };
  const print = attempt.print;

  let content: React.ReactNode = null;
  if (print?.asking) {
    content = (
      <WhichBuild
        item={item}
        attempt={attempt}
        onMore={openSheet}
        follow={follow}
        readOnly={readOnly}
        // The card, the build page and the Journal show the printer's mark beside the title already.
        glyph={where === "sheet"}
      />
    );
  } else if (where === "sheet") {
    content = null;
  } else if (print?.reasons.length) {
    content = (
      <WhyLine
        icon={PrinterIcon}
        action={readOnly ? undefined : { label: "Not this build?", onClick: () => openSheet([]) }}
      >
        <KeepNames text={filedWords(print.reasons)} names={namesIn(print.reasons)} />
      </WhyLine>
    );
  } else if (where === "entry" && attempt.moved) {
    content = <MovedLine moved={attempt.moved} />;
  }
  if (!content) return null;
  return (
    <div className={className}>
      {content}
      {asked && (
        <Suspense fallback={null}>
          <MoveAttemptSheet
            open={open}
            onOpenChange={setOpen}
            item={item}
            attempt={attempt}
            notThis={passed}
            follow={follow}
          />
        </Suspense>
      )}
    </div>
  );
}

/** "Moved here from UOBF-fit-test-ring(2) by you, 2 min ago". */
function MovedLine({ moved }: { moved: AttemptMoved }) {
  const { data: people } = useQuery(peopleQuery);
  const who = useWho();
  const person = people?.find((one) => one.id === moved.by);
  const by = who(person);
  return (
    <WhyLine icon={MoveIntoIcon}>
      Moved here from <KeptName>{moved.fromTitle || "another build"}</KeptName>
      {by ? ` by ${by === "You" ? "you" : by}` : ""}, {inlineTime(moved.at)}
    </WhyLine>
  );
}

interface WhichBuildProps {
  item: ItemView;
  attempt: AttemptView;
  /** Opens the sheet; the builds the question offered, which someone passed over, don't lead it. */
  onMore: (notThis: readonly string[]) => void;
  follow?: (toId: string) => void;
  readOnly: boolean;
  glyph: boolean;
}

/**
 * The printer's question for a print it filed in its own build, in one line: the build the Worker's matcher ranks
 * first (decision 0076), "Is this Herb planter?", with Yes (moved at once, Undo in the toast) and "Another build"
 * (the sheet, searchable). When the first two are as likely as each other (the same reason holds for both: they keep
 * its file, or have its name), it names both, "Is this Herb planter or Balcony planters?", one tap each. When nothing fits,
 * "Which build?" opens the sheet and "Keep it as its own" answers it in one tap. While the guesses are on their way
 * the line keeps its room.
 */
function WhichBuild({ item, attempt, onMore, follow, readOnly, glyph }: WhichBuildProps) {
  const { data: suggestions, isPending } = useQuery(suggestionsQuery(attempt.id));
  const { items: builds } = useBuilds();
  const { items: ideas } = useIdeas();
  const moves = useMoveAttempt(item, attempt, follow);
  const byId = new Map([...builds, ...ideas].map((one) => [one.id, one]));
  const offers = (suggestions ?? []).flatMap((one) => {
    const build = byId.get(one.itemId);
    return build && build.id !== item.id && !build.pending ? [{ build, reasons: one.reasons }] : [];
  });
  const [first, second] = offers;
  // As likely as each other only when the same reason holds for both (the same file, or the job's name), so the
  // line can say it once, true of both: "Both print planter-v2."
  const shared = first && second ? sharedWords([first, second]) : null;
  const offered = first ? (shared && second ? [first, second] : [first]) : [];
  const why = shared ?? rowWords(first?.reasons ?? []);
  // The printer's build is named after the job until someone renames it: then the card's title says the name already.
  const printName = attempt.print?.name ?? null;
  const title = item.title?.trim().toLowerCase();
  const said =
    !!printName &&
    !!title &&
    (printName.trim().toLowerCase() === title || readableTitle(printName)?.toLowerCase() === title);
  return (
    <WhichBuildLine
      loading={isPending}
      printName={said ? null : printName}
      guesses={offered.map(({ build }) => ({
        id: build.id,
        title: itemName(build, build.stage === "idea" ? "idea" : "build"),
        idea: build.stage === "idea",
        onPick: () => moves.move({ item: build }),
      }))}
      why={why}
      names={offered.flatMap((one) => namesIn(one.reasons))}
      onMore={() => onMore(offered.map((one) => one.build.id))}
      onKeep={() => moves.keep()}
      disabled={readOnly}
      glyph={glyph}
    />
  );
}

interface WhichBuildLineProps {
  /** The builds it asks about: the matcher's first, or its first two when they are as likely as each other. */
  guesses?: ReadonlyArray<{ id: string; title: string; idea?: boolean; onPick: () => void }>;
  /** Why: the one guess's reason ("Same file: planter-v2"), or what two share ("Both print planter-v2."). */
  why?: string;
  /** File names in `why`, each kept whole. */
  names?: readonly string[];
  /** The job's name as the printer said it, for "Nothing matched cable-clip-v3.", when the title doesn't say it. */
  printName?: string | null;
  loading?: boolean;
  onMore: () => void;
  /** "Keep it as its own", when nothing fits: the print stays in its own build and the question goes. */
  onKeep?: () => void;
  disabled?: boolean;
  /** The printer's glyph before the question: off where the card shows the printer's mark already. */
  glyph?: boolean;
}

/** The question as it reads, on the card, the build page and the attempt's sheet alike (the styleguide shows it). */
export function WhichBuildLine({
  guesses = [],
  why,
  names = [],
  printName,
  loading,
  onMore,
  onKeep,
  disabled,
  glyph = true,
}: WhichBuildLineProps) {
  const icon = glyph ? PrinterIcon : undefined;
  // The magnifier only where the sheet opens on a field to search in (the desktop's).
  const isDesktop = useIsDesktop();
  const another = (label: string, variant: "secondary" | "quiet") => (
    <Button variant={variant} size="sm" icon={isDesktop ? SearchIcon : undefined} disabled={disabled} onClick={onMore}>
      {label}
    </Button>
  );
  if (loading) return <AskLine icon={icon} loading />;
  const [first, second] = guesses;
  if (!first) {
    return (
      <AskLine
        icon={icon}
        actions={
          <>
            {another("Which build?", "secondary")}
            {onKeep && (
              <Button variant="quiet" size="sm" disabled={disabled} onClick={onKeep}>
                Keep it as its own
              </Button>
            )}
          </>
        }
      >
        Nothing matched {printName ? <KeptName>{printName}</KeptName> : "this print"}.
      </AskLine>
    );
  }
  const ideaWord = guesses.length === 1 && first.idea ? "An idea" : null;
  return (
    <AskLine
      icon={icon}
      detail={
        ideaWord || why ? (
          <MetaList>
            {ideaWord && <span>{ideaWord}</span>}
            {why && (
              // In a span of its own: a MetaList piece is a flex box, which would drop the space after "Same file:".
              <span>
                <KeepNames text={why} names={names} />
              </span>
            )}
          </MetaList>
        ) : undefined
      }
      actions={
        <>
          {second ? (
            // Each named, one tap each; a long name is cut, the question above says it whole.
            guesses.map((guess) => (
              <Button
                key={guess.id}
                variant="secondary"
                size="sm"
                disabled={disabled}
                onClick={guess.onPick}
                className="max-w-56"
              >
                <span className="min-w-0 truncate">{guess.title}</span>
              </Button>
            ))
          ) : (
            <Button variant="secondary" size="sm" disabled={disabled} onClick={first.onPick}>
              Yes
            </Button>
          )}
          {another("Another build", "quiet")}
        </>
      }
    >
      Is this <AskName>{first.title}</AskName>
      {second && (
        <>
          {" "}
          or <AskName>{second.title}</AskName>
        </>
      )}
      ?
    </AskLine>
  );
}

/**
 * The question under a Journal card (decision 0076): the card is one link, so the line sits right under it, not in it.
 * The Journal's copy of the build is read once; the line follows the builds the rest of the app keeps (the change
 * feed), so it goes the moment anyone places the print.
 */
export function JournalAsk({ itemId, attemptId }: { itemId: string; attemptId: string }) {
  const { items } = useBuilds();
  const item = items.find((one) => one.id === itemId);
  const attempt = item?.attempts.find((one) => one.id === attemptId);
  if (!item || !attempt?.print?.asking) return null;
  return <PrintPlace item={item} attempt={attempt} where="card" />;
}
