import { displayName } from "@shared/people";
import { isOffTheBed } from "@shared/print-progress";
import { inlineTime } from "@shared/time";
import { m } from "motion/react";
import { type ReactNode, useState } from "react";
import { OutcomeChip } from "@/components/builds/Outcome";
import { Chip } from "@/components/ui/Chip";
import { ForField } from "@/components/ui/ForField";
import { ForOffer } from "@/components/ui/ForOffer";
import { BuildsIcon, FinishIcon, ShelveIcon, SparkleIcon } from "@/components/ui/icons";
import { MetaList } from "@/components/ui/MetaList";
import { useNamesMe, useOtherPerson } from "@/lib/for-whom";
import type { AttemptView, ItemView } from "@/lib/items";
import { spring } from "@/lib/motion";

interface BuildTitleLineProps {
  item: ItemView;
  /** The attempt still printing (or off the bed, waiting for how it went): its chip says more than the stage's. */
  printing: AttemptView | undefined;
  /** It was marked done just now: the Done chip pops, with a sparkle. */
  celebrate: boolean;
  /** The "for" line as typed, and its autosaving setter (`useItemFields`). */
  forWhom: string;
  setForWhom: (forWhom: string) => void;
  readOnly: boolean;
  /** At the row's end (a phone's Reopen). */
  children?: ReactNode;
}

/**
 * What sits under a build's title: the "for Sam" line once someone is named, then one row that says where it stands
 * once: a chip (the print's own when one is on the bed, else the stage), when and how many attempts as quiet text,
 * and, while it is in progress and nobody is named, the dashed "For Sam" offer. Done and shelved builds offer nothing.
 */
export function BuildTitleLine({
  item,
  printing,
  celebrate,
  forWhom,
  setForWhom,
  readOnly,
  children,
}: BuildTitleLineProps) {
  const other = useOtherPerson();
  const namesMe = useNamesMe();
  const [asking, setAsking] = useState(false);
  const locked = readOnly || item.pending;
  const count = item.attempts.length;
  const attempts = count ? `${count} ${count === 1 ? "attempt" : "attempts"}` : "";
  const ended = item.stage !== "building" && item.finishedAt;

  return (
    <>
      <ForField
        aria-label="For"
        value={forWhom}
        onChange={(event) => setForWhom(event.target.value)}
        readOnly={locked}
        asking={asking}
        you={namesMe(forWhom)}
        onOpen={() => setAsking(true)}
        onDone={() => setAsking(false)}
      />
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
        <StageChip item={item} printing={printing} celebrate={celebrate} />
        <MetaList className="text-small text-ink-faint">
          {ended ? (
            // The chip says Done or Shelved: the line says when, and after how many attempts.
            <span className="whitespace-nowrap">{inlineTime(ended)}</span>
          ) : (
            attempts && <span className="whitespace-nowrap">{attempts}</span>
          )}
          {ended ? (
            attempts && <span className="whitespace-nowrap">{attempts}</span>
          ) : (
            <span className="whitespace-nowrap">started {inlineTime(item.startedAt ?? item.createdAt)}</span>
          )}
        </MetaList>
        {item.stage === "building" && !forWhom.trim() && !asking && !locked && (
          <ForOffer name={other && displayName(other)} onName={setForWhom} onAsk={() => setAsking(true)} />
        )}
        {children}
      </div>
    </>
  );
}

/** Where a build stands, as a chip. Marking it done pops it, with a sparkle. */
function StageChip({
  item,
  printing,
  celebrate,
}: {
  item: ItemView;
  printing: AttemptView | undefined;
  celebrate: boolean;
}) {
  if (item.stage === "building") {
    return printing ? (
      <OutcomeChip outcome={null} offTheBed={isOffTheBed(printing)} />
    ) : (
      <Chip tone="semolina" icon={BuildsIcon}>
        On the bed
      </Chip>
    );
  }
  if (item.stage === "shelved") {
    return <Chip icon={ShelveIcon}>Shelved</Chip>;
  }
  return (
    <m.span
      key={celebrate ? "celebrate" : "done"}
      initial={celebrate ? { scale: 0.5, rotate: -10, opacity: 0 } : false}
      animate={{ scale: 1, rotate: 0, opacity: 1 }}
      transition={spring.snappy}
      className="relative inline-flex"
    >
      <Chip tone="basil" icon={FinishIcon}>
        Done
      </Chip>
      {celebrate && (
        <m.span
          initial={{ opacity: 0, scale: 0.4, x: -4, y: 4 }}
          animate={{ opacity: [0, 1, 0], scale: [0.4, 1.2, 0.9], x: 6, y: -8 }}
          transition={{ duration: 0.9, ease: "easeOut" }}
          className="text-semolina absolute -top-1.5 -right-2.5"
          aria-hidden
        >
          <SparkleIcon size={16} weight="fill" />
        </m.span>
      )}
    </m.span>
  );
}
