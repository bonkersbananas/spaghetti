import { gramsText } from "@shared/ledger";
import type { WeekWaiting as Waiting } from "@shared/week";
import { Link } from "@tanstack/react-router";
import { PrinterIcon, SpaghettiIcon, SpoolIcon, UpNextIcon } from "@/components/ui/icons";
import { Section } from "@/components/ui/Section";
import { Line, Listed, sentenceLink } from "./WeekLines";

const name = (title: string | null) => title?.trim() || "Untitled";

/** True when there is anything to say. */
export const somethingWaiting = (waiting: Waiting | null): waiting is Waiting =>
  !!waiting && waiting.upNext.length + waiting.failedLast.length + waiting.low.length + waiting.upkeep.length > 0;

/** What is waiting right now, on this week's page only: the queue, a build to try again, a low spool, upkeep. */
export function WeekWaiting({ waiting }: { waiting: Waiting }) {
  return (
    <Section id="week-waiting" title="Waiting" size="overline" className="max-w-content">
      <ul className="m-0 flex list-none flex-col gap-3.5 p-0">
        {waiting.upNext.length > 0 && (
          <Line icon={UpNextIcon}>
            Up next:{" "}
            <Listed
              items={waiting.upNext.map((idea) => (
                <Link key={idea.id} to="/ideas/$ideaId" params={{ ideaId: idea.id }} className={sentenceLink}>
                  {name(idea.title)}
                </Link>
              ))}
            />
            .
          </Line>
        )}
        {waiting.failedLast.map((build) => (
          <Line key={build.id} icon={SpaghettiIcon}>
            <Link to="/builds/$buildId" params={{ buildId: build.id }} className={sentenceLink}>
              {name(build.title)}
            </Link>{" "}
            is waiting for another go: the last print was spaghetti.
          </Line>
        ))}
        {waiting.low.map((spool) => (
          <Line key={spool.id} icon={SpoolIcon}>
            <Link to="/pantry/$spoolId" params={{ spoolId: spool.id }} className={sentenceLink}>
              {spool.name}
            </Link>{" "}
            is running low
            {spool.gramsLeft !== null && `, about ${gramsText(Math.max(0, spool.gramsLeft))} left`}.
          </Line>
        ))}
        {waiting.upkeep.map((task) => (
          <Line key={task.id} icon={PrinterIcon}>
            <Link to="/printer" className={sentenceLink}>
              Time to {task.name.charAt(0).toLowerCase()}
              {task.name.slice(1)}
            </Link>
            .
          </Line>
        ))}
      </ul>
    </Section>
  );
}
