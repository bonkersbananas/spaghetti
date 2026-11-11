import type { Person } from "@shared/api";
import { gramsText } from "@shared/ledger";
import type { Week, WeekStage } from "@shared/week";
import { Link } from "@tanstack/react-router";
import { Fragment, type ReactNode } from "react";
import { BuildsIcon, CommentIcon, IdeasIcon, PrintingIcon, SpoolIcon } from "@/components/ui/icons";
import { Section } from "@/components/ui/Section";

const sentenceLink = "text-ink decoration-ink/30 hover:decoration-ink underline underline-offset-4";
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** One quiet line: a small mark, then a sentence. */
export function Line({ icon: Icon, children }: { icon: typeof BuildsIcon; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <Icon size={20} className="text-ink-faint mt-0.5 shrink-0" aria-hidden />
      <p className="text-body text-ink-soft min-w-0 text-pretty">{children}</p>
    </li>
  );
}

/** "A, B and C", and "and 2 more" after three. */
export function Listed({ items, total = items.length }: { items: ReactNode[]; total?: number }) {
  const more = total - items.length;
  const all = more > 0 ? [...items, `${more} more`] : items;
  return (
    <>
      {all.map((entry, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: the pieces of a sentence have no identity.
        <Fragment key={index}>
          {index > 0 && (index === all.length - 1 ? " and " : ", ")}
          {entry}
        </Fragment>
      ))}
    </>
  );
}

/** An idea opens as an idea and everything started opens as a build. */
export function ItemLink({ id, stage, children }: { id: string; stage: WeekStage; children: ReactNode }) {
  return stage === "idea" ? (
    <Link to="/ideas/$ideaId" params={{ ideaId: id }} className={sentenceLink}>
      {children}
    </Link>
  ) : (
    <Link to="/builds/$buildId" params={{ buildId: id }} className={sentenceLink}>
      {children}
    </Link>
  );
}

export { sentenceLink };

/** A long note stands in for a title: its first words. */
const short = (text: string) => {
  const clean = text.trim().replace(/[.!\s]+$/, "");
  if (clean.length <= 28) return clean;
  const cut = clean.slice(0, 28);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 12)).trimEnd()}…`;
};
const firstName = (full: string) => full.split(" ")[0] ?? full;

const name = (title: string | null, fallback = "Untitled") => title?.trim() || fallback;

interface WeekLinesProps {
  week: Week;
  people: Map<string, Person>;
}

/**
 * What happened, in a few quiet lines: how the prints went, which builds were worked on and finished, the ideas
 * and who captured them, what you two said to each other, the filament. Every name is a link. Computed, never
 * written by Claude.
 */
export function WeekLines({ week, people }: WeekLinesProps) {
  const { prints } = week;
  const how = [
    prints.worked && `${prints.worked} worked`,
    prints.partly && `${prints.partly} partly`,
    prints.spaghetti && `${prints.spaghetti} spaghetti`,
    prints.printing && `${prints.printing} on the bed`,
  ].filter(Boolean);

  // The builds the prints belonged to, once each, in the order they were printed.
  const builds = new Map<string, string | null>();
  for (const print of [...week.made, ...week.onTheBed].sort((a, b) => a.at - b.at))
    builds.set(print.itemId, print.title);
  const printed = [...builds].slice(0, 3);

  const ideasBy = new Map<string, number>();
  for (const idea of week.ideas) ideasBy.set(idea.by, (ideasBy.get(idea.by) ?? 0) + 1);
  const who = [...ideasBy].map(([id, count]) => ({ name: firstName(people.get(id)?.name ?? "Someone"), count }));

  const talkers = Object.keys(week.comments.byPerson);
  const topThread = week.comments.threads[0];

  return (
    <Section id="week-lines" title="The week in a few lines" size="overline" className="max-w-content">
      <ul className="m-0 flex list-none flex-col gap-3.5 p-0">
        {prints.total > 0 && (
          <Line icon={PrintingIcon}>
            {plural(prints.total, "print")}
            {how.length > 0 && `: ${how.join(", ")}`}.
          </Line>
        )}
        {printed.length > 0 && (
          <Line icon={BuildsIcon}>
            Worked on{" "}
            <Listed
              total={builds.size}
              items={printed.map(([id, title]) => (
                <Link key={id} to="/builds/$buildId" params={{ buildId: id }} className={sentenceLink}>
                  {name(title)}
                </Link>
              ))}
            />
            .
          </Line>
        )}
        {week.buildsFinished.length > 0 && (
          <Line icon={BuildsIcon}>
            Finished{" "}
            <Listed
              total={week.buildsFinished.length}
              items={week.buildsFinished.slice(0, 3).map((build) => (
                <Link key={build.id} to="/builds/$buildId" params={{ buildId: build.id }} className={sentenceLink}>
                  {name(build.title)}
                </Link>
              ))}
            />
            .
          </Line>
        )}
        {week.ideas.length > 0 && (
          <Line icon={IdeasIcon}>
            {who.length === 1 ? (
              <>
                {who[0]?.name} captured {plural(week.ideas.length, "idea")}
              </>
            ) : (
              <>
                {who[0]?.name} captured {plural(who[0]?.count ?? 0, "idea")} and {who[1]?.name} {who[1]?.count}
              </>
            )}
            :{" "}
            <Listed
              total={week.ideas.length}
              items={week.ideas.slice(0, 2).map((idea) => (
                <ItemLink key={idea.id} id={idea.id} stage={idea.stage}>
                  {short(name(idea.title, idea.note || "Untitled"))}
                </ItemLink>
              ))}
            />
            .
          </Line>
        )}
        {week.comments.total > 0 && (
          <Line icon={CommentIcon}>
            {talkers.length > 1
              ? `You two exchanged ${plural(week.comments.total, "comment")}`
              : `${people.get(talkers[0] ?? "")?.name ?? "Someone"} left ${plural(week.comments.total, "comment")}`}
            {topThread && (
              <>
                {" "}
                on{" "}
                <ItemLink id={topThread.itemId} stage={topThread.stage}>
                  {name(topThread.title)}
                </ItemLink>
                {week.comments.threads.length > 1 && ` and ${week.comments.threads.length - 1} more`}
              </>
            )}
            .
          </Line>
        )}
        {week.grams !== null && (
          <Line icon={SpoolIcon}>About {gramsText(week.grams)} of filament went through the printer.</Line>
        )}
      </ul>
    </Section>
  );
}
