import type { SearchResponse } from "@shared/api";
import { Link } from "@tanstack/react-router";
import { RecentIcon, SearchIcon } from "@/components/ui/icons";

/** What the search made of the question, when it did more than read the words: a mended typo, a time. */
export function Understood({ shown }: { shown: SearchResponse }) {
  const nothingWorked = shown.intent === "worked" && !shown.attempts.some((hit) => hit.attempt.outcome === "success");
  if (!shown.corrected && !shown.when && !nothingWorked) return null;
  return (
    <div className="text-small text-ink-soft flex flex-wrap items-center gap-x-4 gap-y-1">
      {nothingWorked && (
        <p className="flex items-center gap-1.5">
          <SearchIcon size={16} aria-hidden className="text-ink-faint" />
          <span>Nothing has worked for this yet. These are the closest tries.</span>
        </p>
      )}
      {shown.corrected && (
        <p className="flex items-center gap-1.5">
          <SearchIcon size={16} aria-hidden className="text-ink-faint" />
          <span>
            Showing results for <span className="text-ink font-semibold">{shown.corrected}</span>
          </span>
        </p>
      )}
      {shown.when && (
        <p className="flex items-center gap-1.5">
          <RecentIcon size={16} aria-hidden className="text-ink-faint" />
          <span>
            Printed <span className="text-ink font-semibold">{shown.when.label}</span>
          </span>
          {shown.when.weekMonday && (
            <Link
              to="/week/$monday"
              params={{ monday: shown.when.weekMonday }}
              className="focus-ring text-ink rounded-xs font-semibold underline underline-offset-2"
            >
              Open that week
            </Link>
          )}
        </p>
      )}
    </div>
  );
}
