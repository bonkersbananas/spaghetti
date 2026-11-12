import type { Comment } from "@shared/comments";
import { COMMENT_MAX, splitTrailingLink } from "@shared/comments";
import { type ReactionKind, summarizeReactions } from "@shared/reactions";
import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useRef, useState } from "react";
import { TextArea } from "@/components/ui/Field";
import { EditIcon, MoreIcon, TrashIcon } from "@/components/ui/icons";
import { LinkCard } from "@/components/ui/LinkCard";
import { AddReactionButton, Bubble, ReactionPicker, ReactionPills } from "@/components/ui/Message";
import { Popover } from "@/components/ui/Popover";
import { Sheet } from "@/components/ui/Sheet";
import { cn } from "@/lib/cn";
import { deleteComment, editComment, reactToComment } from "@/lib/comments";
import { linkify } from "@/lib/linkify";
import { useIsDesktop } from "@/lib/use-media-query";

interface EditableBubbleProps {
  comment: Comment;
  mine: boolean;
  editing: boolean;
  onEdit: (on: boolean) => void;
  readOnly: boolean;
  /** Lit for a moment: the comment a search found. */
  highlighted?: boolean;
  /** The signed-in person, who reacts. */
  me: string | undefined;
  /** A person's name, for who reacted. */
  nameOf: (userId: string) => string;
}

/**
 * One message with its reactions under it. Every message has a quiet button for reacting (a smiley; on yours a "…"
 * that also holds Edit and Delete), and Edit turns the bubble into a field in place.
 */
export function EditableBubble({
  comment,
  mine,
  editing,
  onEdit,
  readOnly,
  highlighted,
  me,
  nameOf,
}: EditableBubbleProps) {
  const queryClient = useQueryClient();
  const isDesktop = useIsDesktop();
  const [menuOpen, setMenuOpen] = useState(false);
  const [text, setText] = useState(comment.body);
  const cancelled = useRef(false);

  if (editing) {
    return (
      <div className="w-full min-w-0">
        <TextArea
          autoFocus
          appearance="surface"
          minRows={1}
          aria-label="Edit your comment"
          maxLength={COMMENT_MAX}
          value={text}
          onFocus={(event) => event.currentTarget.setSelectionRange(text.length, text.length)}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              cancelled.current = true;
              event.currentTarget.blur();
            } else if (event.key === "Enter" && !event.shiftKey && isDesktop && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
          // Leaving the field keeps the change: nothing typed is lost; Escape is the way out without it.
          onBlur={() => {
            if (!cancelled.current) editComment(queryClient, comment, text);
            cancelled.current = false;
            onEdit(false);
          }}
        />
        <p className="text-caption text-ink-faint mt-1.5 px-1">
          {isDesktop ? "Enter saves, Esc leaves it as it was." : "Tap outside to save."}
        </p>
      </div>
    );
  }

  const react = (kind: ReactionKind) => me && reactToComment(queryClient, comment, kind, me);
  const given = new Set((comment.reactions ?? []).filter((r) => r.userId === me).map((r) => r.kind));
  const label = mine ? "Your comment" : `${nameOf(comment.authorId)}'s comment`;

  const rows = (close: () => void): ReactNode => (
    <div className="flex flex-col">
      <ReactionPicker
        compact={isDesktop}
        given={given}
        disabled={!me}
        onPick={(kind) => {
          react(kind);
          close();
        }}
        className={cn(mine && "mb-1.5", !isDesktop && mine && "mb-3")}
      />
      {mine && (
        <>
          <MenuRow
            icon={<EditIcon size={20} aria-hidden />}
            onSelect={() => {
              close();
              setText(comment.body);
              onEdit(true);
            }}
          >
            Edit
          </MenuRow>
          <MenuRow
            icon={<TrashIcon size={20} aria-hidden />}
            onSelect={() => {
              close();
              deleteComment(queryClient, comment);
            }}
          >
            Delete
          </MenuRow>
        </>
      )}
    </div>
  );

  const { text: shown, url } = splitTrailingLink(comment.body);
  const cardOnly = !shown && !!url;
  const buttonClass = cn(
    "opacity-0 group-hover/bubble:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100",
    // On a phone the bubble's tap opens the menu; a message with no bubble (only a link) keeps its button in view.
    cardOnly ? "max-md:opacity-100" : "max-md:pointer-events-none",
  );
  const openSheet = isDesktop ? undefined : () => setMenuOpen(true);
  const menuButton = mine ? (
    <button
      type="button"
      aria-label="Options for your comment"
      title="Options"
      disabled={readOnly}
      onClick={openSheet}
      className={cn(
        "pressable focus-ring touch-target text-ink-faint hover:bg-ink/5 hover:text-ink flex size-8 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-40",
        buttonClass,
      )}
    >
      <MoreIcon size={18} weight="bold" aria-hidden />
    </button>
  ) : (
    <AddReactionButton
      label={`React to ${label}`}
      disabled={readOnly || !me}
      onClick={openSheet}
      className={buttonClass}
    />
  );

  const aside = isDesktop ? (
    <Popover
      label={label}
      side="bottom"
      align={mine ? "end" : "start"}
      className="w-auto p-1.5"
      trigger={menuButton}
      open={menuOpen}
      onOpenChange={setMenuOpen}
    >
      {rows(() => setMenuOpen(false))}
    </Popover>
  ) : (
    <>
      {/* On a phone the other person's message has no button beside it: it would stick out past a full-width bubble
          and widen the page. A tap on the bubble opens the sheet; a message that is only a link has its smiley under it. */}
      {mine && menuButton}
      <Sheet open={menuOpen} onOpenChange={setMenuOpen} title={mine ? "Your comment" : `React to ${label}`}>
        {rows(() => setMenuOpen(false))}
      </Sheet>
    </>
  );

  const smileyBelow = !mine && !isDesktop && cardOnly;
  const pills =
    summarizeReactions(comment.reactions, me).length || smileyBelow ? (
      <ReactionPills
        reactions={comment.reactions}
        me={me}
        nameOf={nameOf}
        onToggle={react}
        disabled={readOnly || !me}
        align={mine ? "end" : "start"}
      >
        {smileyBelow && (
          <AddReactionButton label={`React to ${label}`} disabled={readOnly || !me} onClick={() => setMenuOpen(true)} />
        )}
      </ReactionPills>
    ) : null;

  // A message that ends with a link shows it as a card instead of the raw address; mid-sentence links stay in the text.
  return (
    <Bubble
      id={`comment-${comment.id}`}
      highlighted={highlighted}
      mine={mine}
      edited={comment.editedAt !== null}
      aside={aside}
      onTap={!isDesktop && !readOnly && me ? () => setMenuOpen(true) : undefined}
      below={
        url || pills ? (
          <>
            {url && <LinkCard url={url} className="w-72 max-w-full" />}
            {cardOnly && comment.editedAt !== null && (
              <span className="text-caption text-ink-faint px-1">(edited)</span>
            )}
            {pills}
          </>
        ) : undefined
      }
    >
      {shown ? linkify(shown, "text-ink font-medium underline decoration-ink/30 underline-offset-2") : undefined}
    </Bubble>
  );
}

function MenuRow({ icon, onSelect, children }: { icon: ReactNode; onSelect: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      className="text-body text-ink hover:bg-ink/5 focus-visible:bg-ink/5 flex min-h-12 w-full items-center gap-3 rounded-md px-3 text-left outline-none md:min-h-11"
      onClick={onSelect}
    >
      {icon}
      {children}
    </button>
  );
}
