import type { SearchResponse } from "@shared/api";
import { Link } from "@tanstack/react-router";
import { RecentIcon, SearchIcon } from "@/components/ui/icons";

/** What the search made of the question, when it did more than read the words: a mended typo, a time. */
export function Understood({ shown }: { shown: SearchResponse }) {
  if (!shown.corrected && !shown.when) return null;
  return (
    <div className="text-small text-ink-soft flex flex-wrap items-center gap-x-4 gap-y-1">
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
              className="focus-ring text-tomato-ink rounded-xs font-semibold underline-offset-2 hover:underline"
            >
              Open that week
            </Link>
          )}
        </p>
      )}
    </div>
  );
}
