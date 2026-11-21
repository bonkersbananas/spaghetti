import type { AttemptMoved } from "@shared/api";
import { filedWords, namesIn } from "@shared/print-match";
import { inlineTime } from "@shared/time";
import { useQuery } from "@tanstack/react-query";
import { type ComponentProps, lazy, Suspense, useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { BuildsIcon, type Icon, IdeasIcon, MoveIntoIcon, PrinterIcon, SearchIcon } from "@/components/ui/icons";
import { KeepNames, KeptName } from "@/components/ui/KeepNames";
import { PickRow } from "@/components/ui/PickRow";
import { Skeleton } from "@/components/ui/Skeleton";
import { WhyLine } from "@/components/ui/WhyLine";
import { type AttemptView, type ItemView, useBuilds, useIdeas } from "@/lib/items";
import { offerLines, suggestionsQuery, useMoveAttempt } from "@/lib/print-moves";
import { peopleQuery } from "@/lib/queries";
import { useReadOnly } from "@/lib/read-only";
import { itemName } from "@/lib/recent";
import { useIsDesktop } from "@/lib/use-media-query";
import { useWho } from "@/lib/who";
import { pictureOf } from "./BuildPick";

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
 * Where a print the printer bridge filed is, and why (decision 0076). A print in its own build asks "Which build is
 * this?" with the builds it may belong to as rows a tap takes, then "Another build" and "Its own build"; a print the
 * app filed in a build says why in one quiet line with "Not this build?"; an attempt moved here says from where. Every
 * way to change it opens the same sheet, and every move has an Undo.
 */
export default function PrintPlace({ item, attempt, where, className }: PrintPlaceProps) {
  const [open, setOpen] = useState(false);
  // The sheet's code comes with the first tap.
  const [asked, setAsked] = useState(false);
  // Opened from the question, whose guesses the card shows already: the sheet leaves them out.
  const [fromQuestion, setFromQuestion] = useState(false);
  const readOnly = useReadOnly(item.pending || attempt.pending);
  const openSheet = (question: boolean) => {
    setFromQuestion(question);
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
        action={readOnly ? undefined : { label: "Not this build?", onClick: () => openSheet(false) }}
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
            withoutGuesses={fromQuestion}
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
  /** Opens the sheet: from the question (`true`: its guesses are on the card already), or to move it at all. */
  onMore: (question: boolean) => void;
  readOnly: boolean;
}

/**
 * The printer's question for a print it filed in its own build: the builds it may belong to (at most three), each a
 * row a tap takes, then "Another build" (the sheet) and "Its own build". Nothing is asked when nothing fits: one quiet
 * line says so, with a way to move it anyway.
 */
function WhichBuild({ item, attempt, onMore, readOnly }: WhichBuildProps) {
  const { data: suggestions, isPending } = useQuery(suggestionsQuery(attempt.id));
  const { items: builds } = useBuilds();
  const { items: ideas } = useIdeas();
  const moves = useMoveAttempt(item, attempt);
  const byId = new Map([...builds, ...ideas].map((one) => [one.id, one]));
  const offers = (suggestions ?? []).flatMap((one) => {
    const build = byId.get(one.itemId);
    return build && build.id !== item.id && !build.pending ? [{ build, reasons: one.reasons }] : [];
  });
  const printName = attempt.print?.name ?? null;

  if (!isPending && !offers.length) {
    return (
      <WhyLine icon={PrinterIcon} action={readOnly ? undefined : { label: "Move it", onClick: () => onMore(false) }}>
        Nothing matched {printName ? <KeptName>{printName}</KeptName> : "it"}, so it has its own build.
      </WhyLine>
    );
  }
  // The build is named after the job until someone renames it: then the card's title says the name already.
  const said = !!printName && printName.trim().toLowerCase() === item.title?.trim().toLowerCase();
  const { shared, lines, names } = offerLines(offers);
  return (
    <WhichBuildQuestion
      name={said ? null : printName}
      shared={shared}
      names={names}
      loading={isPending}
      offers={offers.map(({ build }, index) => ({
        id: build.id,
        photo: pictureOf(build),
        glyph: build.stage === "idea" ? IdeasIcon : BuildsIcon,
        title: itemName(build, build.stage === "idea" ? "idea" : "build"),
        line: lines[index] ?? "",
        idea: build.stage === "idea",
        onSelect: () => moves.move({ item: build }),
      }))}
      onMore={() => onMore(true)}
      onKeep={() => moves.keep()}
      disabled={readOnly}
    />
  );
}

interface WhichBuildQuestionProps {
  /** The job's name as the printer said it, when the card's title doesn't say it already. */
  name?: string | null;
  /** What every guess has in common, said once ("Both print planter-v2."). */
  shared?: string | null;
  /** File names in the lines, each kept whole. */
  names?: readonly string[];
  /** The guesses are on their way: a row's room is kept for them, so the card doesn't jump. */
  loading?: boolean;
  /** The builds it may belong to, best first, each with what sets it apart (or why, when their reasons differ). */
  offers: Array<{
    id: string;
    photo: ComponentProps<typeof PickRow>["photo"];
    glyph: Icon;
    title: string;
    line: string;
    /** An idea, which the print would start: marked so. */
    idea?: boolean;
    onSelect: () => void;
  }>;
  onMore: () => void;
  onKeep: () => void;
  disabled?: boolean;
}

/** The question as it reads (the styleguide shows it with sample builds). */
export function WhichBuildQuestion({
  name,
  shared,
  names = [],
  loading,
  offers,
  onMore,
  onKeep,
  disabled,
}: WhichBuildQuestionProps) {
  const headingId = useId();
  // The magnifier only where "Another build" opens a field to search in (the desktop's sheet).
  const isDesktop = useIsDesktop();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1">
      <div className="flex flex-col gap-0.5">
        <h4 id={headingId} className="text-body text-ink flex items-center gap-2 font-sans font-semibold">
          <PrinterIcon size={18} aria-hidden className="text-ink-faint shrink-0" />
          Which build is this?
        </h4>
        {(name || shared) && (
          <p className="text-small text-ink-faint pl-6.5 text-pretty">
            {name && (
              <>
                The printer calls it <KeptName>{name}</KeptName>.{shared ? " " : ""}
              </>
            )}
            {shared && <KeepNames text={shared} names={names} />}
          </p>
        )}
      </div>
      <div className="flex flex-col">
        {loading && <Skeleton className="my-1 h-12 w-full rounded-lg" />}
        {offers.map((offer) => (
          <PickRow
            key={offer.id}
            photo={offer.photo}
            glyph={{ icon: offer.glyph }}
            title={offer.title}
            mark={offer.idea ? <Chip>Idea</Chip> : undefined}
            meta={<KeepNames text={offer.line} names={names} />}
            disabled={disabled}
            onSelect={offer.onSelect}
          />
        ))}
      </div>
      <div className="-mx-3 flex flex-wrap items-center gap-x-1">
        <Button
          variant="quiet"
          size="sm"
          icon={isDesktop ? SearchIcon : undefined}
          disabled={disabled}
          onClick={onMore}
        >
          Another build
        </Button>
        <Button variant="quiet" size="sm" icon={BuildsIcon} disabled={disabled} onClick={onKeep}>
          Its own build
        </Button>
      </div>
    </section>
  );
}
