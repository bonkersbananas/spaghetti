import { diffSettings, type SettingDiff } from "@shared/attempts";
import { useState } from "react";
import { Disclosure } from "@/components/ui/Disclosure";
import { MetaList } from "@/components/ui/MetaList";
import { Overline } from "@/components/ui/Overline";
import type { AttemptView } from "@/lib/items";
import { formatMinutes } from "./settings";

type Compared = Pick<AttemptView, "number" | "outcome" | "settings">;

const none = "—";

/** What an attempt took, said the way the entry says it: its own time, else "est. 3 h 10 min". */
function took(attempt: Compared): string {
  const { actualMinutes, estimatedMinutes } = attempt.settings;
  if (attempt.outcome === null) return none;
  if (actualMinutes !== undefined) return formatMinutes(actualMinutes);
  if (estimatedMinutes !== undefined) return `est. ${formatMinutes(estimatedMinutes)}`;
  return none;
}

function failedAt(attempt: Compared): string {
  const { failedAtPercent, failedAtLayer } = attempt.settings;
  if (attempt.outcome === null) return none;
  if (failedAtPercent !== undefined) return `${failedAtPercent}%`;
  if (failedAtLayer !== undefined) return `layer ${failedAtLayer}`;
  return none;
}

/** The results side by side: what happened, not what was chosen, so no highlight. */
function results(
  older: Compared,
  newer: Compared,
): Array<{ key: string; label: string; before: string; after: string }> {
  const grams = (attempt: Compared) =>
    attempt.outcome !== null && attempt.settings.weightGrams !== undefined ? `${attempt.settings.weightGrams} g` : none;
  return [
    { key: "time", label: "Time", before: took(older), after: took(newer) },
    { key: "filament", label: "Filament", before: grams(older), after: grams(newer) },
    { key: "failed", label: "Failed at", before: failedAt(older), after: failedAt(newer) },
  ].filter((row) => row.before !== none || row.after !== none);
}

function Rows({
  rows,
  older,
  newer,
}: {
  rows: Array<{ key: string; label: string; before: string; after: string; highlight?: boolean }>;
  older: Compared;
  newer: Compared;
}) {
  return (
    <table className="w-full table-fixed border-separate border-spacing-y-2 text-left">
      {/* Phones show one photo at a time, so the columns are named; on desktop the headers above them do it. */}
      <thead className="md:sr-only">
        <tr className="text-caption text-ink-faint text-left font-semibold">
          <th scope="col" className="sr-only md:w-36">
            Setting
          </th>
          <th scope="col" className="pr-3 font-semibold">
            Attempt {older.number}
          </th>
          <th scope="col" className="font-semibold">
            Attempt {newer.number}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className="text-small align-baseline">
            <th scope="row" className="text-ink-faint w-24 pr-3 text-left font-normal md:w-36">
              {row.label}
            </th>
            <td className="text-ink tabular pr-3">{row.before}</td>
            <td className="text-ink tabular">
              {row.highlight ? (
                <span className="bg-semolina-soft/70 rounded-xs px-1 font-medium">{row.after}</span>
              ) : (
                row.after
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Two attempts set against each other, older first: what changed (the newer
 * value on the change highlight, the same one the chips use), the settings
 * that stayed the same (behind a disclosure), and how each went. The rows come
 * from `diffSettings`, the function the chips come from, so they never disagree.
 */
export function CompareTable({ older, newer }: { older: Compared; newer: Compared }) {
  const [showSame, setShowSame] = useState(false);
  const diff: SettingDiff[] = diffSettings(older.settings, newer.settings);
  const changed = diff.filter((row) => row.changed);
  const same = diff.filter((row) => !row.changed && !row.unset);
  const went = results(older, newer);
  return (
    <div className="flex flex-col gap-6">
      <section aria-label="What changed" className="flex flex-col gap-2">
        <Overline as="h3">What changed</Overline>
        {changed.length > 0 ? (
          <Rows
            older={older}
            newer={newer}
            rows={changed.map((row) => ({
              key: row.key,
              label: row.label,
              before: row.before,
              after: row.after,
              highlight: true,
            }))}
          />
        ) : (
          <p className="text-small text-ink-faint">Nothing was set differently.</p>
        )}
        {same.length > 0 && (
          <Disclosure open={showSame} onOpenChange={setShowSame} title={`Same in both (${same.length})`}>
            <MetaList className="text-small text-ink-soft tabular">
              {same.map((row) => (
                <span key={row.key} className="whitespace-nowrap">
                  {row.label} {row.after}
                </span>
              ))}
            </MetaList>
          </Disclosure>
        )}
      </section>
      <section aria-label="How it went" className="flex flex-col gap-2">
        <Overline as="h3">How it went</Overline>
        {went.length > 0 ? (
          <Rows older={older} newer={newer} rows={went} />
        ) : (
          <p className="text-small text-ink-faint">
            {older.outcome === null || newer.outcome === null
              ? "Still printing: the results come when it's done."
              : "No times or weights logged yet."}
          </p>
        )}
      </section>
    </div>
  );
}
