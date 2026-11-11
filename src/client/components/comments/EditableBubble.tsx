import type { Comment } from "@shared/comments";
import { COMMENT_MAX, splitTrailingLink } from "@shared/comments";
import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useRef, useState } from "react";
import { TextArea } from "@/components/ui/Field";
import { EditIcon, MoreIcon, TrashIcon } from "@/components/ui/icons";
import { LinkCard } from "@/components/ui/LinkCard";
import { Bubble } from "@/components/ui/Message";
import { Popover, PopoverClose } from "@/components/ui/Popover";
import { Sheet } from "@/components/ui/Sheet";
import { cn } from "@/lib/cn";
import { deleteComment, editComment } from "@/lib/comments";
import { linkify } from "@/lib/linkify";
import { useIsDesktop } from "@/lib/use-media-query";

interface EditableBubbleProps {
  comment: Comment;
  mine: boolean;
  editing: boolean;
  onEdit: (on: boolean) => void;
  readOnly: boolean;
}

/** One message; yours have a quiet "…" for Edit and Delete, and Edit turns the bubble into a field in place. */
export function EditableBubble({ comment, mine, editing, onEdit, readOnly }: EditableBubbleProps) {
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

  const rows = (close?: () => void): ReactNode => (
    <div className="flex flex-col">
      <MenuRow
        icon={<EditIcon size={20} aria-hidden />}
        close={close}
        onSelect={() => {
          setText(comment.body);
          onEdit(true);
        }}
      >
        Edit
      </MenuRow>
      <MenuRow
        icon={<TrashIcon size={20} aria-hidden />}
        close={close}
        onSelect={() => deleteComment(queryClient, comment)}
      >
        Delete
      </MenuRow>
    </div>
  );

  const { text: shown, url } = splitTrailingLink(comment.body);
  const cardOnly = !shown && !!url;
  const menuButton = (
    <button
      type="button"
      aria-label="Options for your comment"
      disabled={readOnly}
      onClick={isDesktop ? undefined : () => setMenuOpen(true)}
      className={cn(
        "pressable focus-ring touch-target text-ink-faint hover:bg-ink/5 hover:text-ink flex size-8 shrink-0 items-center justify-center rounded-full opacity-0 transition-colors group-hover/bubble:opacity-100 focus-visible:opacity-100 disabled:opacity-40 data-[state=open]:opacity-100",
        // On a phone the bubble's tap opens the menu; a message with no bubble (only a link) keeps its button in view.
        cardOnly ? "max-md:opacity-100" : "max-md:pointer-events-none",
      )}
    >
      <MoreIcon size={18} weight="bold" aria-hidden />
    </button>
  );

  const aside = !mine ? undefined : isDesktop ? (
    <Popover label="Your comment" side="bottom" align="end" className="w-44 p-1.5" trigger={menuButton}>
      {rows()}
    </Popover>
  ) : (
    <>
      {menuButton}
      <Sheet open={menuOpen} onOpenChange={setMenuOpen} title="Your comment">
        {rows(() => setMenuOpen(false))}
      </Sheet>
    </>
  );

  // A message that ends with a link shows it as a card instead of the raw address; mid-sentence links stay in the text.
  return (
    <Bubble
      mine={mine}
      edited={comment.editedAt !== null}
      aside={aside}
      onTap={mine && !isDesktop && !readOnly ? () => setMenuOpen(true) : undefined}
      below={
        url ? (
          <>
            <LinkCard url={url} className="w-72 max-w-full" />
            {cardOnly && comment.editedAt !== null && (
              <span className="text-caption text-ink-faint px-1">(edited)</span>
            )}
          </>
        ) : undefined
      }
    >
      {shown ? linkify(shown, "text-ink font-medium underline decoration-ink/30 underline-offset-2") : undefined}
    </Bubble>
  );
}

function MenuRow({
  icon,
  close,
  onSelect,
  children,
}: {
  icon: ReactNode;
  close?: () => void;
  onSelect: () => void;
  children: ReactNode;
}) {
  const button = (
    <button
      type="button"
      className="text-body text-ink hover:bg-ink/5 focus-visible:bg-ink/5 flex min-h-12 w-full items-center gap-3 rounded-md px-3 text-left outline-none md:min-h-11"
      onClick={() => {
        onSelect();
        close?.();
      }}
    >
      {icon}
      {children}
    </button>
  );
  return close ? button : <PopoverClose asChild>{button}</PopoverClose>;
}
