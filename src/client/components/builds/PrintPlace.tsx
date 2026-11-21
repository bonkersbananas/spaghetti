import type { AttemptMoved } from "@shared/api";
import { whyWords } from "@shared/print-match";
import { inlineTime } from "@shared/time";
import { useQuery } from "@tanstack/react-query";
import { type ComponentProps, lazy, Suspense, useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  BuildsIcon,
  type Icon,
  IdeasIcon,
  MoveIntoIcon,
  PlusIcon,
  PrinterIcon,
  SearchIcon,
} from "@/components/ui/icons";
import { KeepNames, KeptName } from "@/components/ui/KeepNames";
import { Skeleton } from "@/components/ui/Skeleton";
import { SuggestionRow } from "@/components/ui/SuggestionRow";
import { WhyLine } from "@/components/ui/WhyLine";
import { type AttemptView, type ItemView, useBuilds, useIdeas } from "@/lib/items";
import { offerWhys, suggestionsQuery, useMoveAttempt } from "@/lib/print-moves";
import { peopleQuery } from "@/lib/queries";
import { useReadOnly } from "@/lib/read-only";
import { itemName } from "@/lib/recent";
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

/** "Same file as ring.3mf." → "same file as ring.3mf.", to follow "From the printer:". */
const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/**
 * Where a print the printer bridge filed is, and why (decision 0076). A print in a build of its own asks "Which build
 * is this?" with the builds it may belong to as offers, "Another build" and "It's new"; a print the app put in a
 * build says why in one quiet line with "Not this build?"; an attempt moved here says from where. Every way to change
 * it opens the same sheet, and every move has an Undo.
 */
export default function PrintPlace({ item, attempt, where, className }: PrintPlaceProps) {
  const [open, setOpen] = useState(false);
  // The sheet's code comes with the first tap.
  const [asked, setAsked] = useState(false);
  const readOnly = useReadOnly(item.pending || attempt.pending);
  const openSheet = () => {
    setAsked(true);
    setOpen(true);
  };
  const print = attempt.print;

  let content: React.ReactNode = null;
  if (print?.asking) {
    content = <WhichBuild item={item} attempt={attempt} onMore={openSheet} readOnly={readOnly} />;
  } else if (print?.reasons.length) {
    content = (
      <WhyLine icon={PrinterIcon} action={readOnly ? undefined : { label: "Not this build?", onClick: openSheet }}>
        From the printer: <KeepNames text={lowerFirst(whyWords(print.reasons, { brief: where === "card" }))} />
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
          <MoveAttemptSheet open={open} onOpenChange={setOpen} item={item} attempt={attempt} />
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
  onMore: () => void;
  readOnly: boolean;
}

/**
 * The printer's question for a print it filed in a build of its own: the builds it may belong to (at most three) as
 * offers, each with why, then "Another build" (the sheet, with search) and "It's new". Nothing is asked when nothing
 * fits: one quiet line says so, with a way to put it in a build anyway.
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
  const whys = offerWhys(offers);
  // The build is named after the job until someone renames it: the card's title says the name already.
  const said = !!attempt.print?.name && attempt.print.name.trim().toLowerCase() === item.title?.trim().toLowerCase();
  const name = said ? null : attempt.print?.name;

  if (!isPending && !offers.length) {
    return (
      <WhyLine icon={PrinterIcon} action={readOnly ? undefined : { label: "Put it in a build", onClick: onMore }}>
        From the printer:{" "}
        {name ? (
          <>
            nothing else fits <KeptName>{name}</KeptName>
          </>
        ) : (
          "nothing else fits it"
        )}
        , so it has a build of its own.
      </WhyLine>
    );
  }
  return (
    <WhichBuildQuestion
      name={name}
      loading={isPending}
      offers={offers.map(({ build }, index) => ({
        id: build.id,
        photo: pictureOf(build),
        glyph: build.stage === "idea" ? IdeasIcon : BuildsIcon,
        title: itemName(build, build.stage === "idea" ? "idea" : "build"),
        why: whys[index] ?? "",
        onSelect: () => moves.move({ item: build }),
      }))}
      onMore={onMore}
      onKeep={() => moves.keep()}
      disabled={readOnly}
    />
  );
}

interface WhichBuildQuestionProps {
  /** The job's name as the printer said it, when the card's title doesn't say it already. */
  name?: string | null;
  /** The guesses are on their way: a row's room is kept for them, so the card doesn't jump. */
  loading?: boolean;
  /** The builds it may belong to, best first, each with why. */
  offers: Array<{
    id: string;
    photo: ComponentProps<typeof SuggestionRow>["photo"];
    glyph: Icon;
    title: string;
    why: string;
    onSelect: () => void;
  }>;
  onMore: () => void;
  onKeep: () => void;
  disabled?: boolean;
}

/** The question as it reads (the styleguide shows it with sample builds). */
export function WhichBuildQuestion({ name, loading, offers, onMore, onKeep, disabled }: WhichBuildQuestionProps) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2.5">
      <div className="flex flex-col gap-0.5">
        <h4 id={headingId} className="text-body text-ink flex items-center gap-2 font-sans font-semibold">
          <PrinterIcon size={18} aria-hidden className="text-ink-faint shrink-0" />
          Which build is this?
        </h4>
        {name && (
          <p className="text-small text-ink-faint pl-6.5">
            The printer calls it <KeptName>{name}</KeptName>.
          </p>
        )}
      </div>
      <div className="flex flex-col gap-2">
        {loading && <Skeleton className="h-14 w-full rounded-lg" />}
        {offers.map((offer) => (
          <SuggestionRow
            key={offer.id}
            photo={offer.photo}
            glyph={offer.glyph}
            title={offer.title}
            why={offer.why}
            disabled={disabled}
            onSelect={offer.onSelect}
          />
        ))}
      </div>
      <div className="-mx-3 flex flex-wrap items-center gap-x-1">
        <Button variant="quiet" size="sm" icon={SearchIcon} disabled={disabled} onClick={onMore}>
          Another build
        </Button>
        <Button variant="quiet" size="sm" icon={PlusIcon} disabled={disabled} onClick={onKeep}>
          It's new
        </Button>
      </div>
    </section>
  );
}
