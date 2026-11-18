import { OUTCOME_LABELS } from "@shared/attempts";
import { isOffTheBed } from "@shared/print-progress";
import { relativeTime } from "@shared/time";
import { useMemo } from "react";
import { coverPhoto } from "@/components/ui/Card";
import { MiniCard } from "@/components/ui/MiniCard";
import { Reflow } from "@/components/ui/Reflow";
import { Section } from "@/components/ui/Section";
import { lastActivity } from "@/lib/builds";
import { type ItemView, useBuilds } from "@/lib/items";
import { coverOf } from "@/lib/previews";
import { usePrintProgress } from "@/lib/print-progress";

/** How many builds the strip shows: a phone's row scrolls, a desktop shows the first three in one row. */
const MOST = 6;

/**
 * Before a search is typed: the builds touched lately as photo tiles, each with how its last print went (or the time
 * left, for one on the bed). A start for the empty half of the screen, and a way back to what worked last time without
 * typing. Loaded after the screen's first paint (lazy), nothing when there are no builds with attempts yet.
 */
export default function Lately() {
  const builds = useBuilds();
  const recent = useMemo(
    () =>
      builds.items
        .filter((build) => build.stage !== "idea" && build.attempts.length > 0)
        .sort((a, b) => lastActivity(b) - lastActivity(a))
        .slice(0, MOST),
    [builds.items],
  );
  if (!recent.length) return null;
  return (
    <Section id="search-lately" title="Lately" size="overline">
      <ul className="no-scrollbar relative -mx-5 -my-2 flex snap-x snap-proximity scroll-px-5 gap-3 overflow-x-auto overscroll-x-contain px-5 py-2 md:mx-0 md:gap-5 md:overflow-visible md:px-0 md:[&>:nth-child(n+4)]:hidden">
        <Reflow>
          {recent.map((build) => (
            <LatelyTile key={build.id} build={build} />
          ))}
        </Reflow>
      </ul>
    </Section>
  );
}

/** One tile: the cover, the title on one line, and "Worked · 2 days ago", or "Printing · 30 min left" while it is on the bed. */
function LatelyTile({ build }: { build: ItemView }) {
  const cover = coverOf(build);
  const last = build.attempts.at(-1);
  const progress = usePrintProgress(
    last && !last.outcome ? last.id : undefined,
    last?.printedAt ?? 0,
    last?.settings.estimatedMinutes,
  );
  let sub: string | undefined;
  if (last?.outcome) sub = `${OUTCOME_LABELS[last.outcome]} · ${relativeTime(last.finishedAt ?? last.printedAt)}`;
  else if (last && isOffTheBed(last)) sub = `Off the bed · ${relativeTime(last.endedAt ?? last.printedAt)}`;
  else if (last) {
    // The time left (the last part of "Layer 70 of 205 · 30 min left"), the same words the sidebar and the cards use.
    const left = progress.state === "running" ? progress.label.split(" · ").at(-1) : undefined;
    sub = left ? `Printing · ${left}` : "Printing";
  }
  return (
    <MiniCard
      roomy
      link={{ to: "/builds/$buildId", params: { buildId: build.id } }}
      photo={coverPhoto(cover, "")}
      note={cover.kind === "note" ? cover.text : build.note || undefined}
      title={cover.kind === "note" && cover.fromTitle ? undefined : build.title?.trim() || undefined}
      sub={sub}
    />
  );
}
