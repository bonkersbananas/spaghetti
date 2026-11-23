import type { AttemptMoved } from "@shared/api";
import { filedWords, namesIn, rowWords } from "@shared/print-match";
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
   */
  where: "card" | "entry";
  className?: string;
}

/**
 * Where a print the printer bridge filed is, and why (decision 0076). A print in its own build asks in one line,
 * "Is this Herb planter?" with Yes and "Another build" (or, when nothing fits, "Which build?"); a print the app
 * filed in a build says why in one quiet line with "Not this build?"; an attempt moved here says from where. Every
 * way to change it opens the same sheet, and every move has an Undo. The card on the bed and the attempt on the build
 * page ask in the same words.
 */
export default function PrintPlace({ item, attempt, where, className }: PrintPlaceProps) {
  const [open, setOpen] = useState(false);
  // The sheet's code comes with the first tap.
  const [asked, setAsked] = useState(false);
  // The build the question offered and someone passed over ("Another build"): the sheet leaves it out.
  const [passed, setPassed] = useState<string | null>(null);
  const readOnly = useReadOnly(item.pending || attempt.pending);
  const openSheet = (notThis: string | null) => {
    setPassed(notThis);
    setAsked(true);
    setOpen(true);
  };
  const print = attempt.print;

  let content: React.ReactNode = null;
  if (print?.asking) {
    content = <WhichBuild item={item} attempt={attempt} onMore={openSheet} readOnly={readOnly} />;
  } else if (print?.reasons.length) {
    content = (
      <WhyLine
        icon={PrinterIcon}
        action={readOnly ? undefined : { label: "Not this build?", onClick: () => openSheet(null) }}
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
          <MoveAttemptSheet open={open} onOpenChange={setOpen} item={item} attempt={attempt} notThis={passed} />
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
  /** Opens the sheet, leaving out the build the question offered when someone passed it over. */
  onMore: (notThis: string | null) => void;
  readOnly: boolean;
}

/**
 * The printer's question for a print it filed in its own build, in one line: the build the Worker's matcher ranks
 * first (decision 0076), "Is this Herb planter?", with Yes (moved at once, Undo in the toast) and "Another build"
 * (the sheet, searchable); when nothing fits, "Which build?" opens the sheet. While the guesses are on their way the
 * line keeps its room.
 */
function WhichBuild({ item, attempt, onMore, readOnly }: WhichBuildProps) {
  const { data: suggestions, isPending } = useQuery(suggestionsQuery(attempt.id));
  const { items: builds } = useBuilds();
  const { items: ideas } = useIdeas();
  const moves = useMoveAttempt(item, attempt);
  const byId = new Map([...builds, ...ideas].map((one) => [one.id, one]));
  const likely = (suggestions ?? []).flatMap((one) => {
    const build = byId.get(one.itemId);
    return build && build.id !== item.id && !build.pending ? [{ build, reasons: one.reasons }] : [];
  })[0];
  return (
    <WhichBuildLine
      loading={isPending}
      printName={attempt.print?.name ?? null}
      likely={
        likely && {
          title: itemName(likely.build, likely.build.stage === "idea" ? "idea" : "build"),
          why: rowWords(likely.reasons),
          names: namesIn(likely.reasons),
          idea: likely.build.stage === "idea",
        }
      }
      onYes={likely ? () => moves.move({ item: likely.build }) : undefined}
      onMore={() => onMore(likely?.build.id ?? null)}
      disabled={readOnly}
    />
  );
}

interface WhichBuildLineProps {
  /** The build the matcher ranks first, as it reads; none when nothing fits. */
  likely?: { title: string; why: string; names: readonly string[]; idea?: boolean } | null | undefined;
  /** The job's name as the printer said it, for "Nothing matched cable-clip-v3." */
  printName?: string | null;
  loading?: boolean;
  onYes?: () => void;
  onMore: () => void;
  disabled?: boolean;
}

/** The question as it reads, on the card and on the build page alike (the styleguide shows it with sample builds). */
export function WhichBuildLine({ likely, printName, loading, onYes, onMore, disabled }: WhichBuildLineProps) {
  // The magnifier only where the sheet opens on a field to search in (the desktop's).
  const isDesktop = useIsDesktop();
  if (loading) return <AskLine icon={PrinterIcon} loading />;
  if (!likely) {
    return (
      <AskLine
        icon={PrinterIcon}
        actions={
          <Button
            variant="secondary"
            size="sm"
            icon={isDesktop ? SearchIcon : undefined}
            disabled={disabled}
            onClick={onMore}
          >
            Which build?
          </Button>
        }
      >
        Nothing matched {printName ? <KeptName>{printName}</KeptName> : "this print"}.
      </AskLine>
    );
  }
  return (
    <AskLine
      icon={PrinterIcon}
      detail={
        likely.idea || likely.why ? (
          <MetaList>
            {likely.idea && <span>An idea</span>}
            {likely.why && (
              // In a span of its own: a MetaList piece is a flex box, which would drop the space after "Same file:".
              <span>
                <KeepNames text={likely.why} names={likely.names} />
              </span>
            )}
          </MetaList>
        ) : undefined
      }
      actions={
        <>
          <Button variant="secondary" size="sm" disabled={disabled} onClick={onYes}>
            Yes
          </Button>
          <Button
            variant="quiet"
            size="sm"
            icon={isDesktop ? SearchIcon : undefined}
            disabled={disabled}
            onClick={onMore}
          >
            Another build
          </Button>
        </>
      }
    >
      Is this <AskName>{likely.title}</AskName>?
    </AskLine>
  );
}
