import { type DraftFailure, FAILURE_LINES, type ItemDraft } from "@shared/draft";
import { firstModelLink } from "@shared/model-links";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { SparkleIcon, UndoIcon } from "@/components/ui/icons";
import { Overline } from "@/components/ui/Overline";
import { Skeleton } from "@/components/ui/Skeleton";
import { requestDraft, siteName, undoDraft, useDraftsEnabled } from "@/lib/drafts";
import type { ItemView } from "@/lib/items";

interface DraftNoteProps {
  item: ItemView;
  /** What the title and the note say right now (they may have been tidied since the draft). */
  title: string;
  note: string;
  readOnly: boolean;
}

/**
 * Claude's part of an idea captured from a model page, under its note. Reading: a calm line and two quiet bars
 * where the words will land. Drafted: a marker for as long as the text is still what Claude wrote (the way the
 * printer's suggested tag is marked), what the page said about the model, and one tap to take it all back.
 * Failed: one honest line and a retry. Otherwise, for a model link that was written by hand, the way to ask.
 * Nothing at all when the Worker has no key.
 */
export function DraftNote({ item, title, note, readOnly }: DraftNoteProps) {
  const queryClient = useQueryClient();
  const enabled = useDraftsEnabled();
  const draft = item.draft;
  const link = firstModelLink(note);
  const disabled = readOnly || item.pending;

  if (draft?.status === "reading") {
    return (
      <div className="mt-1" role="status">
        <p className="text-small text-ink-soft flex items-center gap-2">
          <SparkleIcon size={16} weight="fill" className="text-ink-soft sg-pulse" />
          Reading the {siteName(draft)} page…
        </p>
      </div>
    );
  }

  if (draft?.status === "failed") {
    const failure: DraftFailure = draft.failure ?? "unreadable";
    return (
      <p className="text-small text-ink-soft mt-1 flex flex-wrap items-center gap-x-2" role="status">
        {FAILURE_LINES[failure]}
        {failure !== "cap" && (
          <Button
            variant="quiet"
            size="sm"
            disabled={disabled}
            onClick={() => void requestDraft(queryClient, item, draft.url)}
          >
            Try again
          </Button>
        )}
      </p>
    );
  }

  if (draft?.status === "drafted") {
    const untouched =
      (draft.applied.includes("title") && !!draft.title && title === draft.title) ||
      (draft.applied.includes("note") && !!draft.note && note.startsWith(draft.note));
    return (
      <div className="mt-1 flex flex-col gap-3">
        {untouched && (
          <p className="text-small text-ink-faint flex flex-wrap items-center gap-x-2">
            <span className="flex items-center gap-1.5">
              <SparkleIcon size={14} weight="fill" aria-hidden className="text-ink-soft" />
              Drafted by Claude from {siteName(draft)}
            </span>
            <Button
              variant="quiet"
              size="sm"
              icon={UndoIcon}
              disabled={disabled}
              onClick={() => void undoDraft(queryClient, item.id)}
            >
              Undo
            </Button>
          </p>
        )}
        <FromThePage draft={draft} />
      </div>
    );
  }

  if (enabled && link && !disabled) {
    return (
      <Button
        variant="secondary"
        icon={SparkleIcon}
        className="mt-1 self-start"
        onClick={() => void requestDraft(queryClient, item, link.url)}
      >
        Draft from this page
      </Button>
    );
  }
  return null;
}

const ROWS: Array<[keyof NonNullable<ItemDraft["findings"]>, string]> = [
  ["designer", "Designer"],
  ["license", "License"],
  ["material", "Material"],
  ["plate", "Plate"],
  ["settings", "Settings"],
];

/** What the page said about the model, as Claude read it: only the rows it found. */
function FromThePage({ draft }: { draft: ItemDraft }) {
  const rows = ROWS.filter(([key]) => draft.findings?.[key]);
  if (!rows.length) return null;
  return (
    <section aria-labelledby="from-the-page">
      <Overline as="h2" id="from-the-page">
        From the {siteName(draft)} page
      </Overline>
      <dl className="mt-2 grid grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-1.5">
        {rows.map(([key, label]) => (
          <div key={key} className="contents">
            <dt className="text-small text-ink-faint">{label}</dt>
            <dd className="text-small text-ink min-w-0 break-words">{draft.findings?.[key]}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
