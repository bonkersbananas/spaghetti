import { type AttemptSettings, mergeNote } from "@shared/attempts";
import type { Coach } from "@shared/coach";
import { applyCoachSettings, type CoachItem, coachApplies, coachChangeWords, liveCoachItems } from "@shared/coach";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button, IconButton } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { ClaudeLine } from "@/components/ui/ClaudeLine";
import { CheckIcon, CloseIcon, SparkleIcon, UndoIcon } from "@/components/ui/icons";
import { Overline } from "@/components/ui/Overline";
import { cn } from "@/lib/cn";
import { setCoachDismissed } from "@/lib/coach";
import { useReadOnly } from "@/lib/read-only";
import { useIsDesktop } from "@/lib/use-media-query";

const IDEAS = "Claude's ideas for the next try";

/** Where the suggestions will go, while Claude thinks: a pulse, not a spinner. */
function Thinking({ className }: { className?: string }) {
  return (
    <ClaudeLine working className={cn("px-0.5", className)}>
      Thinking about the next try…
    </ClaudeLine>
  );
}

function Heading({ children }: { children: string }) {
  return (
    <Overline as="span" className="flex items-center gap-1.5">
      <SparkleIcon size={12} weight="fill" aria-hidden />
      {children}
    </Overline>
  );
}

interface CoachNoteProps {
  coach: Coach;
  itemId: string;
  attemptId: string;
  className?: string;
  /** The region's name, when a page shows several (the styleguide). */
  label?: string;
}

/**
 * Claude's ideas for the next try, under the attempt that went wrong on the build page: quietly marked as Claude's
 * (dashed, like every suggestion), at most three short lines each with its one-line why, and one tap to dismiss.
 * It never asks for anything. Taking one is in the Log attempt sheet (`CoachSuggestions`).
 */
export function CoachNote({ coach, itemId, attemptId, className, label = IDEAS }: CoachNoteProps) {
  const queryClient = useQueryClient();
  const readOnly = useReadOnly();
  if (coach.status === "thinking") return <Thinking className={className} />;
  const items = liveCoachItems(coach);
  if (!items.length) return null;
  return (
    <section aria-label={label} className={cn("flex flex-col gap-2 pt-1", className)}>
      <Heading>Claude's ideas for the next try</Heading>
      <ul className="flex flex-col gap-2.5">
        {items.map((item) => (
          <li key={item.id} className="flex items-start gap-2">
            <div className="flex min-w-0 flex-1 flex-col">
              <p className="text-body text-ink font-semibold">{item.title}</p>
              <p className="text-small text-ink-soft">{item.why}</p>
            </div>
            {!readOnly && (
              <IconButton
                icon={CloseIcon}
                label={`Dismiss: ${item.title}`}
                size="sm"
                className="touch-target -mt-1 -mr-1"
                onClick={() => void setCoachDismissed(queryClient, itemId, attemptId, item.id, true)}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

interface CoachSuggestionsProps {
  coach: Coach;
  itemId: string;
  attemptId: string;
  /** Which attempt it is about, for the heading. */
  attemptNumber: number;
  settings: AttemptSettings;
  note: string;
  label?: string;
  /** Sets the sheet's settings and note: only ever called by a tap. */
  onUse: (next: { settings?: AttemptSettings; note?: string }) => void;
}

/**
 * In the Log attempt sheet: the same suggestions as one-tap "Use this" chips that fill the attempt's changes
 * (settings, or a line in the note), told in the words the attempt's changes use ("added a brim", "bed 55 → 60 °C").
 * Nothing is set without a tap; a tapped one says so and can be undone.
 */
export function CoachSuggestions({
  coach,
  itemId,
  attemptId,
  attemptNumber,
  settings,
  note,
  label = IDEAS,
  onUse,
}: CoachSuggestionsProps) {
  const queryClient = useQueryClient();
  const isDesktop = useIsDesktop();
  // What each tapped suggestion replaced, so it can be put back.
  const [used, setUsed] = useState<Record<string, AttemptSettings>>({});
  if (coach.status === "thinking") return <Thinking />;
  const items = liveCoachItems(coach);
  if (!items.length) return null;

  const use = (item: CoachItem) => {
    const before: Record<string, unknown> = {};
    for (const key of Object.keys(item.settings ?? {})) before[key] = settings[key as keyof AttemptSettings];
    setUsed((current) => ({ ...current, [item.id]: before as AttemptSettings }));
    onUse({
      settings: applyCoachSettings(settings, item),
      ...(item.note ? { note: mergeNote(note, item.note).replace(/\n/g, " ") } : {}),
    });
  };
  const undo = (item: CoachItem) => {
    const before = used[item.id];
    if (!before) return;
    const next: Record<string, unknown> = { ...settings };
    for (const key of Object.keys(item.settings ?? {})) {
      const value = before[key as keyof AttemptSettings];
      if (value === undefined) delete next[key];
      else next[key] = value;
    }
    setUsed(({ [item.id]: _gone, ...rest }) => rest);
    onUse({
      settings: next as AttemptSettings,
      ...(item.note ? { note: note.replace(` · ${item.note}`, "").replace(item.note, "").trim() } : {}),
    });
  };

  return (
    <section aria-label={label} className="flex flex-col gap-1 px-0.5">
      <Heading>{`Claude's ideas · after attempt ${attemptNumber}`}</Heading>
      <ul className="flex flex-col gap-1">
        {items.map((item) => {
          const applied = !coachApplies(item, settings, note);
          const words = coachChangeWords(item, settings);
          return (
            <li key={item.id} className="flex items-start gap-2 py-2">
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex flex-col">
                  <p className="text-body text-ink font-semibold">{item.title}</p>
                  <p className="text-small text-ink-soft">{item.why}</p>
                </div>
                {applied ? (
                  <p className="text-small text-basil-ink flex items-center gap-1.5 font-semibold">
                    <CheckIcon size={16} weight="bold" aria-hidden />
                    In this attempt
                  </p>
                ) : (
                  <ul className="flex flex-wrap gap-1.5" aria-label="Fills in">
                    {words.slice(0, 3).map((word) => (
                      <li key={word} className="max-w-full">
                        <Chip suggested tone="semolina" className="max-w-full">
                          {word}
                        </Chip>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {applied ? (
                  used[item.id] && (
                    <Button variant="quiet" size="sm" icon={UndoIcon} onClick={() => undo(item)}>
                      Undo
                    </Button>
                  )
                ) : (
                  <Button variant="secondary" size={isDesktop ? "sm" : "md"} onClick={() => use(item)}>
                    Use this
                  </Button>
                )}
                {!applied && (
                  <IconButton
                    icon={CloseIcon}
                    label={`Dismiss: ${item.title}`}
                    size="sm"
                    className="touch-target"
                    onClick={() => void setCoachDismissed(queryClient, itemId, attemptId, item.id, true)}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
