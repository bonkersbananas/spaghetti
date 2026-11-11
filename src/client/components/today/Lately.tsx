import type { JournalEntry as Entry, Item, Person } from "@shared/api";
import { Link } from "@tanstack/react-router";
import { JournalEntry } from "@/components/journal/JournalEntry";
import { Button } from "@/components/ui/Button";
import { Overline } from "@/components/ui/Overline";
import { Skeleton } from "@/components/ui/Skeleton";

interface LatelyProps {
  /** "November so far". */
  label: string;
  /** The month in one sentence: null while it loads, "" when there is nothing to say yet. */
  summary: string | null;
  /** Newest first. */
  entries: Entry[];
  items: Map<string, Item>;
  people: Map<string, Person>;
  via: (agentId: string | null | undefined) => string | undefined;
}

/** How many of the newest entries Today shows. */
export const LATELY_ENTRIES = 3;

/**
 * The journal's head: the month in one sentence (the sentence the journal writes under the same heading), then
 * the newest entries as quiet rows. Hidden when there is nothing to say and nothing happened.
 */
export function Lately({ label, summary, entries, items, people, via }: LatelyProps) {
  if (!entries.length && !summary) return null;
  return (
    <section aria-labelledby="today-lately" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-4">
          <Overline as="h2" id="today-lately">
            {label}
          </Overline>
          <Link
            to="/year"
            className="text-small text-ink-faint hover:text-ink focus-ring -my-2 rounded-sm py-2 whitespace-nowrap"
          >
            See the year
          </Link>
        </div>
        {summary === null ? (
          <Skeleton className="h-6 w-64 max-w-full" />
        ) : (
          summary && <p className="font-display text-title text-ink">{summary}</p>
        )}
      </div>
      <div className="flex flex-col gap-1">
        {entries.slice(0, LATELY_ENTRIES).map((entry) => {
          const item = items.get(entry.itemId);
          if (!item) return null;
          const attempt = item.attempts.find((candidate) => candidate.id === entry.attemptId);
          return (
            <JournalEntry
              key={entry.key}
              entry={entry}
              item={item}
              person={people.get(attempt?.createdBy ?? entry.by)}
              via={via(entry.via)}
              when="time"
              compact
            />
          );
        })}
      </div>
      <Link to="/journal" className="focus-ring self-start rounded-sm">
        <Button variant="quiet" size="sm" tabIndex={-1} className="-ml-3">
          See the whole journal
        </Button>
      </Link>
    </section>
  );
}
