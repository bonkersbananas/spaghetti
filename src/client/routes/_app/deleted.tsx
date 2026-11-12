import { OUTCOME_LABELS } from "@shared/attempts";
import { daysLeft } from "@shared/deleted";
import { inlineTime } from "@shared/time";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { EmptyPot } from "@/components/illustrations/EmptyPot";
import { itemName } from "@/components/journal/JournalEntry";
import { PageHeader } from "@/components/shell/PageHeader";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { BuildsIcon, UndoIcon } from "@/components/ui/icons";
import { MetaList } from "@/components/ui/MetaList";
import { Photo } from "@/components/ui/Photo";
import { Section } from "@/components/ui/Section";
import { RowSkeleton } from "@/components/ui/Skeleton";
import { deletedQuery, restoreDeletedAttempt, restoreDeletedItem } from "@/lib/deleted";
import { photoSrc } from "@/lib/previews";
import { canEdit, useReadOnly } from "@/lib/read-only";

export const Route = createFileRoute("/_app/deleted")({
  component: RecentlyDeleted,
});

const goesFor = (deletedAt: number) => {
  const days = daysLeft(deletedAt, Date.now());
  return days === 1 ? "goes for good tomorrow" : `goes for good in ${days} days`;
};

function RecentlyDeleted() {
  const { data, isPending, error } = useQuery(deletedQuery);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const readOnly = useReadOnly();
  const empty = data && !data.items.length && !data.attempts.length;

  return (
    <>
      <PageHeader title="Deleted" subtitle="Gone for good after 30 days." />
      {isPending ? (
        <div className="flex max-w-2xl flex-col gap-3" aria-hidden>
          <RowSkeleton />
          <RowSkeleton />
        </div>
      ) : error ? (
        <EmptyState className="py-10 md:py-20" illustration={<EmptyPot />} title="Can't look just now">
          The list needs the connection. Nothing is lost.
        </EmptyState>
      ) : empty ? (
        <EmptyState className="py-10 md:py-20" illustration={<EmptyPot />} title="Nothing deleted lately">
          Whatever you delete waits here for a month first, so a missed Undo isn't the end.
        </EmptyState>
      ) : (
        <div className="flex max-w-2xl flex-col gap-10">
          {data && data.items.length > 0 && (
            <Section id="deleted-items" title="Ideas and builds" size="title" count={data.items.length}>
              <ul className="flex flex-col">
                {data.items.map((entry) => {
                  const name = itemName(entry);
                  return (
                    <li key={entry.id} className="flex items-center gap-3.5 py-2">
                      {entry.photoId ? (
                        <Photo src={photoSrc(entry.photoId, "thumb")} alt="" className="size-12 shrink-0 rounded-md" />
                      ) : (
                        <span className="bg-ink/5 text-ink-faint flex size-12 shrink-0 items-center justify-center rounded-md">
                          <BuildsIcon size={22} aria-hidden />
                        </span>
                      )}
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="text-body text-ink truncate font-semibold">{name.text}</span>
                        <MetaList className="text-small text-ink-faint">
                          <span>{entry.stage === "idea" ? "Idea" : "Build"}</span>
                          <span>deleted {inlineTime(entry.deletedAt)}</span>
                          <span>{goesFor(entry.deletedAt)}</span>
                        </MetaList>
                      </span>
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={UndoIcon}
                        disabled={readOnly}
                        aria-label={`Restore ${name.text}`}
                        onClick={() =>
                          canEdit() &&
                          void restoreDeletedItem(queryClient, entry, () =>
                            entry.stage === "idea"
                              ? navigate({ to: "/ideas/$ideaId", params: { ideaId: entry.id } })
                              : navigate({ to: "/builds/$buildId", params: { buildId: entry.id } }),
                          )
                        }
                      >
                        Restore
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </Section>
          )}
          {data && data.attempts.length > 0 && (
            <Section id="deleted-attempts" title="Attempts" size="title" count={data.attempts.length}>
              <ul className="flex flex-col">
                {data.attempts.map((entry) => {
                  const of = entry.itemTitle?.trim() || "a build";
                  return (
                    <li key={entry.id} className="flex items-center gap-3.5 py-2">
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="text-body text-ink truncate font-semibold">Attempt of {of}</span>
                        <MetaList className="text-small text-ink-faint">
                          <span>{entry.outcome ? OUTCOME_LABELS[entry.outcome] : "Was printing"}</span>
                          <span>printed {inlineTime(entry.printedAt)}</span>
                          <span>{goesFor(entry.deletedAt)}</span>
                        </MetaList>
                      </span>
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={UndoIcon}
                        disabled={readOnly}
                        aria-label={`Restore the attempt of ${of}`}
                        onClick={() =>
                          canEdit() &&
                          void restoreDeletedAttempt(queryClient, entry, () =>
                            navigate({ to: "/builds/$buildId", params: { buildId: entry.itemId } }),
                          )
                        }
                      >
                        Restore
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </Section>
          )}
        </div>
      )}
    </>
  );
}
