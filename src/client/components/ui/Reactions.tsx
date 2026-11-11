import { REACTIONS, type Reaction, type ReactionKind, reactedBy, summarizeReactions } from "@shared/reactions";
import type { ComponentPropsWithRef, ReactNode } from "react";
import { cn } from "@/lib/cn";
import {
  type Icon,
  PlusIcon,
  ReactBravoIcon,
  ReactChefIcon,
  ReactHotIcon,
  ReactIcon,
  ReactLoveIcon,
  ReactMeltIcon,
  ReactWantIcon,
} from "./icons";

/** Each reaction's glyph and its color: a little sticker, drawn filled. */
const glyphs: Record<ReactionKind, { icon: Icon; tone: string }> = {
  love: { icon: ReactLoveIcon, tone: "text-tomato" },
  chef: { icon: ReactChefIcon, tone: "text-ink-soft" },
  want: { icon: ReactWantIcon, tone: "text-ink-soft" },
  hot: { icon: ReactHotIcon, tone: "text-tomato" },
  bravo: { icon: ReactBravoIcon, tone: "text-basil" },
  melt: { icon: ReactMeltIcon, tone: "text-semolina-ink" },
};

/** A reaction's glyph, in its own color. Decorative: what it means is said beside it. */
export function ReactionGlyph({
  kind,
  size = 18,
  className,
}: {
  kind: ReactionKind;
  size?: number;
  className?: string;
}) {
  const { icon: Glyph, tone } = glyphs[kind];
  return <Glyph size={size} weight="fill" aria-hidden className={cn("shrink-0", tone, className)} />;
}

interface ReactionPillsProps {
  reactions: readonly Reaction[] | undefined;
  /** The signed-in person: their reactions are tinted, and a tap takes one back. */
  me: string | undefined;
  /** A person's name, for "Sam and you". */
  nameOf: (userId: string) => string;
  onToggle: (kind: ReactionKind) => void;
  disabled?: boolean;
  /** At the end of the row: the button that adds one (AddReactionButton). */
  children?: ReactNode;
  /** `end` lines the row up under your own message. */
  align?: "start" | "end";
  className?: string;
}

/**
 * The reactions given to something, one pill per kind, in the curated order. With two people a pill needs no names:
 * yours is tinted, the other person's is plain, and "2" means both of you. A tap gives the same one or takes yours back.
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
          <li key={summary.kind}>
            <button
              type="button"
              aria-pressed={summary.mine}
              disabled={disabled}
              title={`${summary.label}: ${who}`}
              onClick={() => onToggle(summary.kind)}
              className={cn(
                "pressable focus-ring touch-target rounded-pill text-small relative inline-flex h-8 items-center gap-1 px-2.5 font-semibold tabular-nums transition-colors disabled:opacity-60",
                summary.mine
                  ? "bg-tomato-soft text-tomato-ink ring-tomato/30 ring-1 ring-inset"
                  : "bg-cream shadow-soft text-ink-soft",
              )}
            >
              <ReactionGlyph kind={summary.kind} />
              <span className="sr-only">
                {summary.label}, from {who}
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
  /** The kinds you have already given: picked again, they are taken back. */
  given: ReadonlySet<ReactionKind>;
  onPick: (kind: ReactionKind) => void;
  /** Glyphs only, in one row, each named in its tooltip (a desktop menu); otherwise tiles with their names. */
  compact?: boolean;
  disabled?: boolean;
  className?: string;
}

/** The curated set to pick from: big, friendly tiles on a phone, a tight row of glyphs in a desktop menu. */
export function ReactionPicker({ given, onPick, compact = false, disabled, className }: ReactionPickerProps) {
  return (
    <fieldset className={cn(compact ? "flex gap-0.5" : "grid grid-cols-3 gap-2 md:grid-cols-6", className)}>
      <legend className="sr-only">Reactions</legend>
      {REACTIONS.map(({ kind, label }) => {
        const picked = given.has(kind);
        return (
          <button
            key={kind}
            type="button"
            aria-pressed={picked}
            disabled={disabled}
            title={compact ? label : undefined}
            onClick={() => onPick(kind)}
            className={cn(
              "pressable focus-ring flex items-center justify-center transition-colors disabled:opacity-60",
              compact
                ? "size-9 rounded-md"
                : "text-small text-ink-soft min-h-20 flex-col gap-1.5 rounded-lg px-1 py-3 font-semibold",
              picked ? "bg-tomato-soft ring-tomato/30 ring-1 ring-inset" : "hover:bg-ink/5",
              !compact && !picked && "bg-ink/4",
            )}
          >
            <ReactionGlyph kind={kind} size={compact ? 22 : 30} />
            {compact ? <span className="sr-only">{label}</span> : label}
          </button>
        );
      })}
    </fieldset>
  );
}
