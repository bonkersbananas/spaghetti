import type { Person } from "@shared/api";
import { fullTime, relativeTime } from "@shared/time";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Avatar } from "./Avatar";

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
      <Avatar person={person} size="sm" via={via} className="mt-5" />
      <div className={cn("flex max-w-[min(100%,34rem)] min-w-0 flex-col gap-1", mine ? "items-end" : "items-start")}>
        <p className="text-caption text-ink-faint px-1 font-medium">
          <span className="text-ink-soft font-semibold">{name}</span>
          {via && <span> via {via}</span>}
          {" · "}
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
  /** At the side of the bubble (its menu). */
  aside?: ReactNode;
  /** Under the bubble (link cards). */
  below?: ReactNode;
  children: ReactNode;
}

/** One message. Text wraps and keeps its line breaks; yours sit on a tomato tint, the other person's on cream. */
export function Bubble({ mine = false, edited = false, aside, below, children }: BubbleProps) {
  return (
    <div className={cn("group/bubble flex max-w-full min-w-0 flex-col gap-1.5", mine ? "items-end" : "items-start")}>
      <div className={cn("flex max-w-full items-center gap-0.5", mine && "flex-row-reverse")}>
        <div
          className={cn(
            "text-body text-ink min-w-0 rounded-lg px-3.5 py-2 break-words whitespace-pre-wrap",
            mine ? "bg-tomato-soft rounded-ee-xs" : "bg-cream shadow-soft rounded-es-xs",
          )}
        >
          {children}
          {edited && <span className="text-caption text-ink-faint ml-1.5 whitespace-nowrap">(edited)</span>}
        </div>
        {aside}
      </div>
      {below}
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
