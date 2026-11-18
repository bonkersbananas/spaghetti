import { OUTCOME_LABELS } from "@shared/attempts";
import { relativeTime } from "@shared/time";
import { useMemo } from "react";
import { coverPhoto } from "@/components/ui/Card";
import { MiniCard } from "@/components/ui/MiniCard";
import { Reflow } from "@/components/ui/Reflow";
import { Section } from "@/components/ui/Section";
import { lastActivity } from "@/lib/builds";
import { useBuilds } from "@/lib/items";
import { coverOf } from "@/lib/previews";

/** How many builds the strip shows: a phone's row scrolls, a desktop shows the first three in one row. */
const MOST = 6;

/**
 * Before a search is typed: the builds touched lately as photo tiles, each with how its last print went, and one
 * small line of pasta. A start for the empty half of the screen, and a way back to what worked last time without
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
    <Section
      id="search-lately"
      title="Lately"
      size="overline"
      description={<p className="text-small text-ink-faint">Pull on one strand and the whole plate comes with it.</p>}
    >
      <ul className="no-scrollbar relative -mx-5 -my-2 flex snap-x snap-proximity scroll-px-5 gap-3 overflow-x-auto overscroll-x-contain px-5 py-2 md:mx-0 md:gap-5 md:overflow-visible md:px-0 md:[&>:nth-child(n+4)]:hidden">
        <Reflow>
          {recent.map((build) => {
            const cover = coverOf(build);
            const last = build.attempts.at(-1);
            return (
              <MiniCard
                key={build.id}
                link={{ to: "/builds/$buildId", params: { buildId: build.id } }}
                photo={coverPhoto(cover, "")}
                note={cover.kind === "note" ? cover.text : build.note || undefined}
                title={cover.kind === "note" && cover.fromTitle ? undefined : build.title?.trim() || undefined}
                sub={
                  last
                    ? `${last.outcome ? OUTCOME_LABELS[last.outcome] : "Printing"} · ${relativeTime(last.finishedAt ?? last.printedAt)}`
                    : undefined
                }
              />
            );
          })}
        </Reflow>
      </ul>
    </Section>
  );
}
