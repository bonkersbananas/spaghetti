import * as Dialog from "@radix-ui/react-dialog";
import { type ReactNode, type Ref, useEffect, useId, useState } from "react";
import { cn } from "@/lib/cn";
import { type Icon, SearchIcon } from "./icons";
import { Kbd } from "./Kbd";
import { Photo } from "./Photo";
import { Skeleton } from "./Skeleton";

export interface PaletteRow {
  id: string;
  /** The name, with the words that matched marked (a Highlight). */
  title: ReactNode;
  /** The name as plain text (React keys, filtering). The row is named by what it shows. */
  label: string;
  subtitle?: ReactNode;
  /** A photo thumbnail leads the row when there is one… */
  photo?: { src: string; color?: string } | null;
  /** …else this icon on a quiet tile. */
  icon?: Icon;
  /** Chips or other state on the right. */
  trailing?: ReactNode;
  /** The shortcut that does the same, shown on the right. */
  keys?: string[];
}

export interface PaletteGroup {
  id: string;
  label: string;
  rows: PaletteRow[];
}

export interface PaletteHint {
  keys: string[];
  label: string;
}

interface PaletteProps {
  query: string;
  onQueryChange: (query: string) => void;
  groups: PaletteGroup[];
  /** The row Enter would run. */
  activeId: string | undefined;
  onActiveChange: (id: string) => void;
  onRun: (id: string) => void;
  /** Results are still on their way: a couple of placeholder rows close the list. */
  pending?: boolean;
  /** The rows shown answer an earlier query; they dim until the new ones arrive. */
  stale?: boolean;
  /** What to say when nothing matches. */
  empty: { title: string; text: string };
  hints?: PaletteHint[];
  placeholder?: string;
  inputRef?: Ref<HTMLInputElement>;
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
  className?: string;
}

/**
 * The command palette's surface: a search box over grouped rows (people's
 * photos or action icons), one of them picked, the keys it answers to along
 * the bottom. It only draws; the shell decides what the rows are and what
 * they do. A combobox: focus stays in the box while the arrow keys move the
 * pick (aria-activedescendant).
 */
export function PaletteSurface({
  query,
  onQueryChange,
  groups,
  activeId,
  onActiveChange,
  onRun,
  pending,
  stale,
  empty,
  hints,
  placeholder = "Jump to an idea or build, or run an action…",
  inputRef,
  onKeyDown,
  className,
}: PaletteProps) {
  const base = useId();
  const listId = `${base}-list`;
  const optionId = (id: string) => `${base}-${id}`;
  const rowCount = groups.reduce((n, group) => n + group.rows.length, 0);

  // Keep the pick in view while the arrow keys move it.
  useEffect(() => {
    if (activeId) document.getElementById(`${base}-${activeId}`)?.scrollIntoView({ block: "nearest" });
  }, [activeId, base]);

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="flex h-14 shrink-0 items-center gap-3 px-5">
        <SearchIcon size={20} className="text-ink-faint shrink-0" aria-hidden />
        <input
          ref={inputRef}
          // biome-ignore lint/a11y/noAutofocus: opening the palette means typing into it.
          autoFocus
          type="text"
          role="combobox"
          aria-label="Jump to or run"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={activeId ? optionId(activeId) : undefined}
          aria-autocomplete="list"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className="text-lead text-ink placeholder:text-ink-faint min-w-0 flex-1 bg-transparent focus:outline-none focus-visible:shadow-none"
        />
        <Kbd keys={["Esc"]} always />
      </div>
      <div className="bg-hairline h-px shrink-0" aria-hidden />

      <div
        id={listId}
        // A listbox only while it has options (an empty one is invalid); the empty state is plain text.
        {...(rowCount ? { role: "listbox", "aria-label": "Results" } : {})}
        aria-busy={pending || stale || undefined}
        className={cn(
          "max-h-[min(26rem,56vh)] min-h-0 flex-1 overflow-y-auto p-2",
          // Earlier results wait for the new ones with their pictures dimmed; the words stay readable (AA contrast).
          stale && "[&_img]:opacity-60 [&_img]:transition-opacity",
        )}
      >
        {groups.map((group) => (
          // biome-ignore lint/a11y/useSemanticElements: a listbox group is the pattern; <fieldset> is for forms.
          <div key={group.id} role="group" aria-labelledby={`${base}-g-${group.id}`} className="pb-1">
            <div
              id={`${base}-g-${group.id}`}
              className="text-caption text-ink-faint px-3 pt-3 pb-1.5 font-semibold tracking-wider uppercase"
            >
              {group.label}
            </div>
            {group.rows.map((row) => (
              <PaletteRowView
                key={row.id}
                row={row}
                domId={optionId(row.id)}
                active={row.id === activeId}
                onActive={() => onActiveChange(row.id)}
                onRun={() => onRun(row.id)}
              />
            ))}
          </div>
        ))}
        {pending && (
          <div className="flex flex-col gap-1 px-1 pt-1" aria-hidden>
            {[0, 1].map((n) => (
              <div key={n} className="flex items-center gap-3 rounded-md p-2">
                <Skeleton className="size-10 rounded-sm" />
                <div className="flex flex-1 flex-col gap-2">
                  <Skeleton className="h-3.5 w-2/5" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
              </div>
            ))}
          </div>
        )}
        {!rowCount && !pending && (
          <div className="px-4 py-10 text-center">
            <p className="font-display text-title text-ink font-semibold">{empty.title}</p>
            <p className="text-small text-ink-faint mx-auto mt-1 max-w-xs">{empty.text}</p>
          </div>
        )}
      </div>

      {hints && hints.length > 0 && (
        <div className="bg-paper/60 text-caption text-ink-faint flex shrink-0 items-center gap-5 px-5 py-2.5">
          {hints.map((hint) => (
            <span key={hint.label} className="flex items-center gap-1.5">
              <Kbd keys={hint.keys} always />
              {hint.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function PaletteRowView({
  row,
  domId,
  active,
  onActive,
  onRun,
}: {
  row: PaletteRow;
  domId: string;
  active: boolean;
  onActive: () => void;
  onRun: () => void;
}) {
  const FallbackIcon = row.icon;
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the box keeps focus; Enter and the arrow keys are handled there.
    // biome-ignore lint/a11y/useFocusableInteractive: options are picked with aria-activedescendant, never focused.
    <div
      id={domId}
      role="option"
      aria-selected={active}
      // Named by what it shows (title, meta, outcome), so what is read matches what is seen.
      onPointerMove={onActive}
      onClick={onRun}
      className={cn(
        "duration-instant flex cursor-default items-center gap-3 rounded-md p-2 transition-colors",
        active && "bg-ink/6",
      )}
    >
      {row.photo ? (
        <Photo
          src={row.photo.src}
          alt=""
          color={row.photo.color}
          className="size-10 shrink-0 rounded-sm"
          imgClassName="select-none"
        />
      ) : (
        <span
          className={cn(
            "bg-ink/5 text-ink-soft flex size-10 shrink-0 items-center justify-center rounded-sm",
            active && "bg-cream text-ink shadow-soft",
          )}
        >
          {FallbackIcon && <FallbackIcon size={20} aria-hidden />}
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-body text-ink truncate font-medium">{row.title}</span>
        {row.subtitle && <span className="text-small text-ink-faint truncate">{row.subtitle}</span>}
      </span>
      {row.trailing}
      {row.keys && <Kbd keys={row.keys} always />}
    </div>
  );
}

interface PaletteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Runs once the palette is gone, so what it started (a sheet, a page) never
   * fights its focus return. Call `event.preventDefault()` to keep focus where
   * the action put it.
   */
  onClosed?: (event: Event) => void;
  children: ReactNode;
}

/** The palette as an overlay: high on the screen, instant, with the page dimmed behind. */
export function PaletteDialog({ open, onOpenChange, onClosed, children }: PaletteDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="sg-overlay bg-scrim fixed inset-0 z-40" />
        <Dialog.Content
          aria-describedby={undefined}
          onCloseAutoFocus={onClosed}
          className="sg-dialog bg-lifted shadow-float fixed top-[12vh] left-1/2 z-50 flex max-h-[76vh] w-full max-w-xl -translate-x-1/2 flex-col overflow-hidden rounded-xl focus:outline-none"
        >
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** What someone typed into the shell below before the real palette arrived: the palette starts from it. */
let earlyQuery = "";
export const takeEarlyQuery = () => {
  const query = earlyQuery;
  earlyQuery = "";
  return query;
};

/**
 * The palette's frame while its commands are still on the way (the first ⌘K after a page load, before its code has
 * arrived): the dialog and the search box open at once, ready to type into, with placeholder rows. What is typed is
 * kept for the real palette.
 */
export function PaletteShell({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const [query, setQuery] = useState("");
  // Whatever was typed is for the palette that replaces this frame (it has read it by the time this unmounts); a frame
  // that closes unanswered takes its text with it, so a later ⌘K never opens with an old query.
  useEffect(
    () => () => {
      earlyQuery = "";
    },
    [],
  );
  return (
    <PaletteDialog open onOpenChange={onOpenChange}>
      <PaletteSurface
        query={query}
        onQueryChange={(next) => {
          earlyQuery = next;
          setQuery(next);
        }}
        groups={[]}
        activeId={undefined}
        onActiveChange={() => {}}
        onRun={() => {}}
        pending
        empty={{ title: "", text: "" }}
      />
    </PaletteDialog>
  );
}
