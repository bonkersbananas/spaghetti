import { COMMENT_MAX, type Comment, groupThread, type ThreadEntry } from "@shared/comments";
import { displayName } from "@shared/people";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Composer } from "@/components/ui/Composer";
import { CommentIcon } from "@/components/ui/icons";
import { Bubble, MessageGroup, NewDivider } from "@/components/ui/Message";
import { Section } from "@/components/ui/Section";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Sheet } from "@/components/ui/Sheet";
import { useVia } from "@/lib/agents";
import { cn } from "@/lib/cn";
import { sendComment, useDraft, useThread } from "@/lib/comments";
import { scrollBehavior } from "@/lib/motion";
import { peopleQuery, sessionQuery } from "@/lib/queries";
import { useIsDesktop } from "@/lib/use-media-query";
import { EditableBubble } from "./EditableBubble";

interface ThreadProps {
  itemId: string;
  /** Counts up each time something asks to write (the M key, the palette, a notification): focus the field, or open the sheet. */
  writeAsk: number;
  /** Offline, saved things are only for reading. */
  readOnly: boolean;
  /** Replaces the default distance above the thread. */
  className?: string;
}

/**
 * The short thread at the foot of an idea or a build: what the two of you say about it. Empty, it is one quiet
 * line to write on and takes almost no room; with comments it reads like a small conversation, newest at the
 * bottom, the first one you haven't read under a "New" line. On a keyboard the field sits under the messages;
 * on a phone a field-shaped button opens a sheet that rides the keyboard.
 */
export default function Thread({ itemId, writeAsk, readOnly, className }: ThreadProps) {
  const queryClient = useQueryClient();
  const isDesktop = useIsDesktop();
  const { data: me } = useQuery(sessionQuery);
  const { data: people } = useQuery(peopleQuery);
  const via = useVia();
  const { comments, dividerAt, ready } = useThread(itemId, me?.id);
  const [draft, setDraft] = useDraft(itemId);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [lit, setLit] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const root = useRef<HTMLDivElement>(null);

  const other = people?.find((person) => person.id !== me?.id);
  const placeholder = other ? `Say something to ${displayName(other)}` : "Say something";
  const entries = useMemo<ThreadEntry[]>(
    () => (me ? groupThread(comments, { me: me.id, dividerAt: ready ? dividerAt : Number.POSITIVE_INFINITY }) : []),
    [comments, me, dividerAt, ready],
  );
  const person = (id: string) => people?.find((p) => p.id === id);

  // Something asked to write: the field (keyboard) or the sheet (phone).
  const handled = useRef(0);
  useEffect(() => {
    if (writeAsk === 0 || writeAsk === handled.current) return;
    handled.current = writeAsk;
    if (readOnly) return;
    if (isDesktop) {
      root.current?.scrollIntoView({ block: "center", behavior: scrollBehavior() });
      field.current?.focus({ preventScroll: true });
    } else {
      setSheetOpen(true);
    }
  }, [writeAsk, readOnly, isDesktop]);

  // Opened from a notification (?thread=1): bring the thread into view once, without opening the keyboard.
  const arrived = useRef(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // A search hit scrolls to its own comment instead.
    if (arrived.current || !ready || !params.has("thread") || params.has("comment")) return;
    arrived.current = true;
    root.current?.scrollIntoView({ block: "center", behavior: scrollBehavior() });
  }, [ready]);

  // Opened from a search hit (?comment=…): scroll to that comment and light it for a moment.
  const found = useRef(false);
  useEffect(() => {
    if (found.current || !ready) return;
    const id = new URLSearchParams(window.location.search).get("comment");
    if (!id || !comments.some((comment) => comment.id === id)) return;
    found.current = true;
    setLit(id);
    // After the thread has laid out (the first paint of its bubbles), so the scroll lands on the right place.
    requestAnimationFrame(() =>
      document.getElementById(`comment-${id}`)?.scrollIntoView({ block: "center", behavior: scrollBehavior() }),
    );
  }, [ready, comments]);
  useEffect(() => {
    if (!lit) return;
    const timer = window.setTimeout(() => setLit(null), 2600);
    return () => window.clearTimeout(timer);
  }, [lit]);

  function send() {
    if (!me) return;
    if (sendComment(queryClient, itemId, me.id, draft)) {
      setSheetOpen(false);
      // The new message is in view: it is what you did.
      requestAnimationFrame(() => root.current?.scrollIntoView({ block: "end", behavior: scrollBehavior() }));
    }
  }

  const empty = comments.length === 0;
  const headingId = `thread-${itemId}`;
  const writing = isDesktop ? (
    <Composer
      inputRef={field}
      value={draft}
      onChange={setDraft}
      onSend={send}
      placeholder={placeholder}
      label={placeholder}
      disabled={readOnly || !me}
      maxLength={COMMENT_MAX}
    />
  ) : (
    <>
      <button
        type="button"
        disabled={readOnly || !me}
        onClick={() => setSheetOpen(true)}
        className="pressable focus-ring bg-ink/4 shadow-well text-body flex min-h-12 w-full items-center gap-3 rounded-lg px-4 text-left disabled:opacity-60"
      >
        <CommentIcon size={20} className="text-ink-faint shrink-0" aria-hidden />
        {draft.trim() ? (
          <span className="text-ink min-w-0 flex-1 truncate">
            <span className="text-ink-faint">Draft: </span>
            {draft.trim().split("\n")[0]}
          </span>
        ) : (
          <span className="text-ink-faint">{placeholder}</span>
        )}
      </button>
      {/* Mounted closed from the start: a sheet that mounts already open can lay its content wrong. */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen} title={placeholder}>
        <Composer
          autoFocus
          value={draft}
          onChange={setDraft}
          onSend={send}
          placeholder="Write here…"
          label={placeholder}
          maxLength={COMMENT_MAX}
        />
      </Sheet>
    </>
  );

  return (
    <div ref={root} className={cn("max-w-content", className ?? "mt-12 md:mt-16")}>
      {empty || !me ? (
        // Nothing said yet: one quiet line to write on, and a heading only screen readers see.
        <section aria-labelledby={headingId} className="flex flex-col gap-4">
          <SectionHeading id={headingId} className="sr-only">
            Talk it over
          </SectionHeading>
          {writing}
        </section>
      ) : (
        <Section id={headingId} title="Talk it over">
          <ol className="flex flex-col gap-3" aria-label="Comments">
            {entries.map((entry) => {
              if (entry.kind === "new") return <NewDivider key="new" />;
              const author = person(entry.authorId);
              const mine = entry.authorId === me.id;
              const first = entry.comments[0] as Comment;
              return (
                <MessageGroup
                  key={entry.key}
                  person={author ?? { name: "?", color: "clay" }}
                  name={mine ? "You" : displayName(author, "Someone")}
                  via={via(entry.via)}
                  mine={mine}
                  time={first.createdAt}
                >
                  {entry.comments.map((comment) => (
                    <EditableBubble
                      key={comment.id}
                      comment={comment}
                      mine={mine}
                      editing={editing === comment.id}
                      onEdit={(on) => setEditing(on ? comment.id : null)}
                      readOnly={readOnly}
                      highlighted={lit === comment.id}
                    />
                  ))}
                </MessageGroup>
              );
            })}
          </ol>
          {writing}
        </Section>
      )}
    </div>
  );
}
