import type { Person } from "@shared/api";
import { type Reaction, reactedBy, summarizeReactions } from "@shared/reactions";
import { fullTime, relativeTime } from "@shared/time";
import { type ComponentPropsWithRef, lazy, type ReactNode, Suspense, useEffect } from "react";
import { cn } from "@/lib/cn";
import { Avatar } from "./Avatar";
import { PlusIcon, ReactIcon } from "./icons";

interface MessageGroupProps {
  person: Pick<Person, "name" | "color"> & { photoUrl?: string | null };
  /** The name shown over the messages: the person's, or "You". */
  name: string;
  /** The agent it was written through ("Claude for Alex"). */
  via?: string;
  /** Written by the person looking at the screen: it sits at the end side, tinted. */
  mine?: boolean;
  /** When the first message was written. */
  time: number;
  /** The bubbles. */
  children: ReactNode;
  className?: string;
}

/**
 * One person's run of messages in a thread, like a messaging app and not a comment list: their avatar, then
 * their name and the time once, then the bubbles stacked close. The other person's sit at the start; yours at
 * the end, tinted, so who said what reads before any name does.
 */
export function MessageGroup({ person, name, via, mine = false, time, children, className }: MessageGroupProps) {
  return (
    <li className={cn("flex list-none items-start gap-2.5", mine && "flex-row-reverse", className)}>
      {/* Yours carry no avatar and no name: the side and the tint already say it is you. */}
      {!mine && <Avatar person={person} size="sm" via={via} className="mt-5" />}
      <div
        className={cn("flex min-w-0 flex-col gap-1", mine ? "w-full items-end" : "max-w-[min(100%,34rem)] items-start")}
      >
        <p className="text-caption text-ink-faint px-1 font-medium">
          {!mine && <span className="text-ink-soft font-semibold">{name} · </span>}
          {via && <span>via {via} · </span>}
          <time dateTime={new Date(time).toISOString()} title={fullTime(time)}>
            {relativeTime(time)}
          </time>
        </p>
        {children}
      </div>
    </li>
  );
}

interface BubbleProps {
  mine?: boolean;
  /** Shown quietly after the text once the message was changed. */
  edited?: boolean;
  /**
   * The message's options button. It sits beside the bubble and shows only on hover or keyboard focus, but stays a
   * real button, so keyboards and screen readers find it.
   */
  aside?: ReactNode;
  /** A tap on the bubble's text (not on a link): on phones it opens the options. */
  onTap?: () => void;
  id?: string;
  /** Lit for a moment: the comment a search found. */
  highlighted?: boolean;
  /** Under the bubble (a link card). */
  below?: ReactNode;
  /** Without text (a message that is only a link) there is no bubble, just what is `below`. */
  children?: ReactNode;
}

/** One message. Text wraps and keeps its line breaks; yours sit on a tomato tint, the other person's on cream. */
export function Bubble({
  mine = false,
  edited = false,
  highlighted = false,
  aside,
  onTap,
  below,
  children,
  id,
}: BubbleProps) {
  return (
    <div
      id={id}
      className={cn(
        "group/bubble relative flex max-w-full min-w-0 flex-col gap-1.5",
        mine ? "items-end" : "items-start",
      )}
    >
      {children !== undefined && children !== "" && (
        // biome-ignore lint/a11y/noStaticElementInteractions: the tap is a phone extra; the options button beside it is the keyboard's way in.
        // biome-ignore lint/a11y/useKeyWithClickEvents: same.
        <div
          onClick={
            onTap
              ? (event) => {
                  if (!(event.target as Element).closest("a")) onTap();
                }
              : undefined
          }
          className={cn(
            "text-body text-ink min-w-0 rounded-lg px-3.5 py-2 wrap-anywhere whitespace-pre-wrap transition-shadow duration-700",
            highlighted && "ring-semolina ring-offset-paper ring-2 ring-offset-2",
            mine ? "bg-tomato-soft rounded-ee-xs" : "bg-cream shadow-soft rounded-es-xs",
          )}
        >
          {children}
          {edited && <span className="text-caption text-ink-faint ml-1.5 whitespace-nowrap">(edited)</span>}
        </div>
      )}
      {below}
      {/* Outside the bubble, on the side away from the edge: left of yours, right of theirs. */}
      {aside && <div className={cn("absolute top-1", mine ? "right-full mr-1" : "left-full ml-1")}>{aside}</div>}
    </div>
  );
}

/** The line before the first comment you haven't read: "New", in tomato, with a hairline either side. */
export function NewDivider() {
  return (
    <li className="text-caption text-tomato-ink flex list-none items-center gap-3 font-semibold tracking-wider uppercase">
      <span aria-hidden className="bg-tomato/30 h-px flex-1" />
      New
      <span aria-hidden className="bg-tomato/30 h-px flex-1" />
    </li>
  );
}

// --- Reactions (decision 0042). Kept in this file, not one of their own: a new module in this lazy chunk renames it,
// and the changed name in the entry's preload map costs every screen's first load a few bytes. ---

// The full picker (and Frimousse under it) arrives when "more" is pressed, or just before, once the quick row shows.
const loadEmojiPicker = () => import("./EmojiPicker");
const EmojiPicker = lazy(loadEmojiPicker);

interface ReactionPillsProps {
  reactions: readonly Reaction[] | undefined;
  /** The signed-in person: their reactions are tinted, and a tap takes one back. */
  me: string | undefined;
  /** A person's name, for "Sam and you". */
  nameOf: (userId: string) => string;
  onToggle: (emoji: string) => void;
  disabled?: boolean;
  /** At the end of the row: the button that adds one (AddReactionButton). */
  children?: ReactNode;
  /** `end` lines the row up under your own message. */
  align?: "start" | "end";
  className?: string;
}

/**
 * The reactions given to something, one pill per emoji, in the order they were first given. With two people a pill
 * needs no names: yours is tinted, the other person's is plain, and "2" means both of you; the tooltip says who.
 * A tap gives the same one or takes yours back.
 */
export function ReactionPills({
  reactions,
  me,
  nameOf,
  onToggle,
  disabled,
  children,
  align = "start",
  className,
}: ReactionPillsProps) {
  const summaries = summarizeReactions(reactions, me);
  if (!summaries.length && !children) return null;
  return (
    <ul
      aria-label="Reactions"
      className={cn("flex flex-wrap items-center gap-1.5", align === "end" && "justify-end", className)}
    >
      {summaries.map((summary) => {
        const who = reactedBy(summary.userIds, me, nameOf);
        return (
          <li key={summary.emoji}>
            <button
              type="button"
              aria-pressed={summary.mine}
              disabled={disabled}
              title={who}
              onClick={() => onToggle(summary.emoji)}
              className={cn(
                "pressable focus-ring touch-target rounded-pill text-small relative inline-flex h-8 items-center gap-1.5 px-2.5 font-semibold tabular-nums transition-colors disabled:opacity-60",
                summary.mine
                  ? "bg-tomato-soft text-tomato-ink ring-tomato/30 ring-1 ring-inset"
                  : "bg-cream shadow-soft text-ink-soft",
              )}
            >
              <span aria-hidden className="font-emoji text-lead leading-none">
                {summary.emoji}
              </span>
              <span className="sr-only">
                {summary.emoji}, from {who}
              </span>
              {summary.userIds.length > 1 && <span aria-hidden>{summary.userIds.length}</span>}
            </button>
          </li>
        );
      })}
      {children && <li className="flex">{children}</li>}
    </ul>
  );
}

/** The quiet round button that opens the picker: a smiley with a small plus. */
export function AddReactionButton({
  className,
  label = "Add a reaction",
  ...props
}: ComponentPropsWithRef<"button"> & { label?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...props}
      className={cn(
        "pressable focus-ring touch-target rounded-pill text-ink-faint hover:bg-ink/5 hover:text-ink data-[state=open]:bg-ink/5 data-[state=open]:text-ink relative inline-flex size-8 items-center justify-center transition-colors disabled:opacity-40",
        className,
      )}
    >
      <ReactIcon size={20} aria-hidden />
      <PlusIcon size={10} weight="bold" aria-hidden className="bg-paper absolute top-1 right-0.5 rounded-full" />
    </button>
  );
}

interface ReactionPickerProps {
  /** The emoji you have already given: picked again, they are taken back. */
  given: ReadonlySet<string>;
  onPick: (emoji: string) => void;
  /** The quick row (lib/reactions.ts useEmojiUse): the two of you's most used, then the defaults. */
  quick: readonly string[];
  /** Your latest picks, for the full picker. */
  recent?: readonly string[];
  /** Whether the full picker shows instead of the quick row, and the change to make (the sheet grows for it). */
  more: boolean;
  onMore: (more: boolean) => void;
  /** `menu` is the desktop popover: a tight row, and a picker with the search on top. `sheet` is the phone's. */
  layout: "menu" | "sheet";
  disabled?: boolean;
  className?: string;
}

/**
 * What the smiley opens, like Slack's: a quick row of the emoji you use most with a "more" button, which swaps in the
 * full picker (every emoji, searched by name and keyword). Tiles are large on a phone, a tight row in a desktop menu.
 */
export function ReactionPicker({
  given,
  onPick,
  quick,
  recent,
  more,
  onMore,
  layout,
  disabled,
  className,
}: ReactionPickerProps) {
  const sheet = layout === "sheet";
  // Warm the full picker's code while the quick row is up, so "more" is instant.
  useEffect(() => {
    void loadEmojiPicker();
  }, []);
  if (more) {
    return (
      <Suspense
        fallback={
          <p className={cn("text-small text-ink-faint flex items-center justify-center", sheet ? "h-72" : "h-64 w-80")}>
            Loading emoji…
          </p>
        }
      >
        <EmojiPicker
          layout={layout}
          given={given}
          recent={recent}
          onPick={onPick}
          className={cn(!sheet && "w-80", className)}
        />
      </Suspense>
    );
  }
  return (
    <fieldset className={cn(sheet ? "grid grid-cols-7 gap-1.5" : "flex gap-0.5", className)}>
      <legend className="sr-only">Reactions</legend>
      {quick.map((emoji) => {
        const picked = given.has(emoji);
        return (
          <button
            key={emoji}
            type="button"
            aria-pressed={picked}
            disabled={disabled}
            onClick={() => onPick(emoji)}
            className={cn(
              "pressable focus-ring font-emoji flex items-center justify-center rounded-md transition-colors disabled:opacity-60",
              sheet ? "text-headline h-14" : "text-title size-9",
              picked ? "bg-tomato-soft ring-tomato/30 ring-1 ring-inset" : sheet ? "bg-ink/4" : "hover:bg-ink/5",
            )}
          >
            {emoji}
          </button>
        );
      })}
      <button
        type="button"
        aria-label="More emoji"
        title="More emoji"
        disabled={disabled}
        onClick={() => onMore(true)}
        className={cn(
          "pressable focus-ring text-ink-soft hover:text-ink flex items-center justify-center rounded-md transition-colors disabled:opacity-60",
          sheet ? "bg-ink/4 h-14" : "hover:bg-ink/5 size-9",
        )}
      >
        <span className="relative inline-flex">
          <ReactIcon size={sheet ? 28 : 22} aria-hidden />
          <PlusIcon size={10} weight="bold" aria-hidden className="bg-lifted absolute -top-0.5 -right-1 rounded-full" />
        </span>
      </button>
    </fieldset>
  );
}
