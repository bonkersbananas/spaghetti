import type { FixHit } from "@shared/api";
import { tagLabel } from "@shared/attempts";
import type { SearchTerm } from "@shared/search";
import { relativeTime } from "@shared/time";
import { forwardRef } from "react";
import { OutcomeChip } from "@/components/builds/Outcome";
import { ChangeLine } from "@/components/ui/ChangeLine";
import { Highlight } from "@/components/ui/Highlight";
import { BuildsIcon } from "@/components/ui/icons";
import { useTagOptions } from "@/lib/builds";
import { afterWords, attemptLink, ResultRow } from "./Results";
import { StartAgain } from "./StartAgain";

interface FixResultProps {
  fix: FixHit;
  terms: readonly SearchTerm[];
  selected: boolean;
  onHover: () => void;
  onOpen: () => void;
}

/**
 * What fixed a problem the search named: the attempt that went better, the failure it came after, what changed since
 * on the semolina marks the build's story uses, its note, and "Start again with these" under it.
 */
export const FixResult = forwardRef<HTMLAnchorElement, FixResultProps>(function FixResult(
  { fix, terms, selected, onHover, onOpen },
  ref,
) {
  const failureOptions = useTagOptions("failure");
  const { attempt, item, after } = fix;
  const title = item.title?.trim() || "Untitled build";
  const tags = after.tags.map((slug) => tagLabel("failure", slug, failureOptions));
  return (
    <>
      <ResultRow
        ref={ref}
        link={attemptLink(fix)}
        photo={fix.photo}
        fallbackIcon={BuildsIcon}
        selected={selected}
        onPointerEnter={onHover}
        onOpen={onOpen}
      >
        <span className="flex items-center gap-2">
          <OutcomeChip outcome={attempt.outcome} />
          <span className="text-small text-ink-faint ml-auto shrink-0">{relativeTime(attempt.printedAt)}</span>
        </span>
        <span className="text-body text-ink line-clamp-2 min-w-0 font-semibold">
          <Highlight text={title} terms={terms} />
          <span className="text-small text-ink-faint font-medium">
            {" "}
            <span className="whitespace-nowrap">· attempt {fix.number}</span>
            {fix.partsLabel ? ` · ${fix.partsLabel}` : ""}
          </span>
        </span>
        <span className="text-small text-ink-faint">{afterWords(after, tags)}</span>
        {fix.changes.length > 0 ? (
          <ChangeLine
            changes={fix.changes.map((text) => ({ key: text, text }))}
            label={`Changed since attempt ${after.number}: `}
          />
        ) : (
          <span className="text-small text-ink-faint">Same settings as attempt {after.number}</span>
        )}
        {attempt.note && (
          <Highlight text={attempt.note} terms={terms} className="text-body text-ink-soft line-clamp-2" />
        )}
      </ResultRow>
      {/* Beside the link, not in it: a button can't live inside a link. Lined up with the text column. */}
      <div className="pb-1 pl-[6.375rem] md:pl-[7.5rem]">
        <StartAgain hit={fix} onStart={onOpen}>
          Start again with these
        </StartAgain>
      </div>
    </>
  );
});
