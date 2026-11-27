import { isOutcome, type Outcome, outcomeLabel } from "@shared/attempts";
import { isOffTheBed } from "@shared/print-progress";
import type { ReactNode } from "react";
import type { Step } from "@/components/builds/Outcome";
import { coverPhoto } from "@/components/ui/Card";
import { MetaList } from "@/components/ui/MetaList";
import { cn } from "@/lib/cn";
import type { AttemptView, ItemView } from "@/lib/items";
import { coverOf } from "@/lib/previews";
import { usePrintProgress } from "@/lib/print-progress";

/**
 * A build as one row to pick, in "Add to a build" and "Which build is this?": its cover small, then how it stands
 * ("On the bed · 30 min left", "Partly · 3 attempts").
 */
export const inks: Record<Step, string> = {
  success: "text-basil-ink",
  partial: "text-semolina-ink",
  failed: "text-tomato-ink",
  printing: "text-semolina-ink",
  offBed: "text-ink-soft",
};
export const tiles: Record<Step, string> = {
  success: "bg-basil-soft text-basil-ink",
  partial: "bg-semolina-soft text-semolina-ink",
  failed: "bg-tomato-soft text-tomato-ink",
  printing: "bg-semolina-soft text-semolina-ink",
  offBed: "bg-ink/8 text-ink-soft",
};

/** The build's cover (`coverOf`), as small as a pick row's picture. Null: the glyph tile stands in for a note. */
export function pictureOf(build: ItemView) {
  return coverPhoto(coverOf(build), "") ?? null;
}

/**
 * The pictures of builds offered side by side for one print. When they all keep the same file (`sameFile`), each
 * would show that file's plate, one render twice: those show their glyph (build or idea) instead, which tells them
 * apart. A photo of a real print stays.
 */
export function picturesApart(builds: readonly ItemView[], sameFile: boolean) {
  return builds.map((build) => {
    const picture = pictureOf(build);
    return sameFile && picture?.fit === "contain" ? null : picture;
  });
}

/** "30 min left", "Done by now" or "On the bed": the progress sentence kept short. */
export function useLeft(attempt: AttemptView | undefined): string | null {
  const progress = usePrintProgress(attempt?.id, attempt?.printedAt ?? 0, attempt?.settings.estimatedMinutes);
  if (!attempt) return null;
  if (progress.state === "due") return "Done by now";
  if (progress.state === "unknown") return null;
  return (progress.label.split(" · ").at(-1) ?? progress.label).replace(/^[Aa]bout /, "");
}

export function BuildMeta({ build }: { build: ItemView }) {
  const last = build.attempts.at(-1);
  // Its print on the bed, if any: every build says so, not just the newest print (a print started by hand, or
  // another still waiting while the printer runs the next one).
  // Only a build in progress has a print on the bed (as every bed list counts it).
  const printing =
    build.stage === "building"
      ? build.attempts.findLast((attempt) => attempt.outcome === null && !isOffTheBed(attempt))
      : undefined;
  const left = useLeft(printing);
  const count = build.attempts.length;
  const pieces: ReactNode[] = [];
  if (printing) {
    pieces.push(
      <span key="bed" className="text-semolina-ink font-semibold">
        On the bed
      </span>,
    );
    if (left) pieces.push(<span key="left">{left}</span>);
  } else if (last && isOutcome(last.outcome)) {
    pieces.push(
      <span key="outcome" className={cn("font-semibold", inks[last.outcome])}>
        {outcomeLabel(last.outcome)}
      </span>,
    );
  } else if (last && isOffTheBed(last)) {
    pieces.push(<span key="off">Off the bed</span>);
  }
  pieces.push(
    <span key="count">{count ? `${count} ${count === 1 ? "attempt" : "attempts"}` : "No attempts yet"}</span>,
  );
  return <MetaList>{pieces}</MetaList>;
}
