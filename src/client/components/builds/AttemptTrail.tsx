import type { Outcome } from "@shared/attempts";
import { useState } from "react";
import { FinishIcon, type Icon, PrintingIcon } from "@/components/ui/icons";
import { Photo } from "@/components/ui/Photo";
import { cn } from "@/lib/cn";
import { useIsDesktop } from "@/lib/use-media-query";
import { outcomeIcons } from "./Outcome";
import { outcomeSentence, type StripAttempt, word } from "./OutcomeStrip";

export interface TrailAttempt extends StripAttempt {
  /** The attempt's first photo, the face of its step on a phone. */
  photo?: { src: string; color?: string } | null;
}

interface AttemptTrailProps {
  /** Oldest first. */
  attempts: TrailAttempt[];
  /** Picks that attempt (selects it and brings it into view, as J and K do). */
  onPick: (attemptId: string) => void;
  /** The attempt that is open now, drawn as the picked one. */
  selected?: string | null;
  className?: string;
}

type Step = Outcome | "printing" | "offBed";

const stepOf = (attempt: TrailAttempt): Step => attempt.outcome ?? (attempt.offBed ? "offBed" : "printing");

const stepIcons: Record<Step, Icon> = { ...outcomeIcons, printing: PrintingIcon, offBed: FinishIcon };

/** A step's face without a photo: the outcome's soft tones; off the bed is neutral, like its chip. */
const stepTones: Record<Step, string> = {
  success: "bg-basil-soft text-basil-ink",
  partial: "bg-semolina-soft text-semolina-ink",
  failed: "bg-tomato-soft text-tomato-ink",
  printing: "bg-semolina-soft text-semolina-ink",
  offBed: "bg-ink/8 text-ink-soft",
};

/** The badge over a step's photo: the same tones, opaque, so the photo doesn't show through. */
const badgeTones: Record<Step, string> = { ...stepTones, offBed: "bg-cream text-ink-soft" };

/** The ring around a step's photo on phones: the thread's own dot colors (`outcomeDots`), as a ring. */
const stepRings: Record<Step, string> = {
  success: "ring-basil",
  partial: "ring-semolina",
  failed: "ring-tomato",
  printing: "ring-semolina",
  offBed: "ring-ink/30",
};

/** Steps shown at most, a folded "+5" included; tapping that one shows them all. Two rows of six on a phone. */
const MAX_STEPS = 12;

/**
 * The outcome strip as a control (the build page's summary): the build's attempts as a trail, oldest first, each step a button that picks its attempt,
 * joined by the story's thread line. On phones a step is the attempt's photo in a ring of its outcome's color with
 * the outcome's icon as a badge (without a photo, the outcome's soft disc and icon), captioned "#2"; on desktop, where the story
 * beside it shows the photos, it is a small dot holding the icon, its name in the tooltip. No figure inside a step
 * (a number beside an icon reads as a count); the open attempt is inverted like a picked chip: its caption on a
 * phone, the dot itself on desktop. It wraps rather than scrolls, so every step is in view and under a thumb; each
 * row's line runs off its edge, so a wrapped trail still reads as one.
 */
export function AttemptTrail({ attempts, onPick, selected, className }: AttemptTrailProps) {
  const desktop = useIsDesktop();
  const [unfolded, setUnfolded] = useState(false);
  if (attempts.length === 0) return null;
  const overflow = attempts.length > MAX_STEPS;
  const folded = overflow ? attempts.length - (MAX_STEPS - 1) : 0;
  // An attempt picked elsewhere (J/K, a link) among the folded ones unfolds the trail for good, as it does the story.
  const pickedFolded = attempts.slice(0, folded).some((attempt) => attempt.id === selected);
  if (pickedFolded && !unfolded) setUnfolded(true);
  const hidden = unfolded || pickedFolded ? 0 : folded;
  const shown = attempts.slice(hidden);
  const steps = hidden > 0 ? shown.length + 1 : shown.length;
  // The thread: a stub on each side of a step, in the room between steps, at the height of the step's middle.
  const thread = (index: number) =>
    cn(
      "relative flex flex-col items-center px-1.5",
      "before:bg-ink/10 after:bg-ink/10 before:absolute before:left-0 before:h-0.5 before:w-1.5 before:-translate-y-1/2 after:absolute after:right-0 after:h-0.5 after:w-1.5 after:-translate-y-1/2",
      desktop ? "before:top-3.5 after:top-3.5" : "before:top-6 after:top-6",
      index === 0 && "before:hidden",
      index === steps - 1 && "after:hidden",
    );
  const caption = (text: string, picked = false) =>
    !desktop && (
      <span
        aria-hidden
        className={cn(
          "text-caption tabular rounded-pill mt-1 px-1.5 leading-5",
          picked ? "bg-select text-on-select font-semibold" : "text-ink-faint",
        )}
      >
        {text}
      </span>
    );
  return (
    <fieldset
      aria-label={outcomeSentence(attempts)}
      className={cn("m-0 -mx-1.5 flex min-w-0 flex-wrap gap-y-2 border-0 p-0", className)}
    >
      {hidden > 0 && (
        <div className={thread(0)}>
          <button
            type="button"
            title={`${hidden} earlier attempts`}
            aria-label={`Show ${hidden} earlier attempts`}
            aria-expanded={false}
            onClick={() => setUnfolded(true)}
            className={cn(
              "pressable focus-ring touch-target bg-ink/5 text-ink-soft tabular relative flex shrink-0 items-center justify-center rounded-full font-semibold",
              desktop ? "text-caption size-7" : "text-small size-12",
            )}
          >
            +{hidden}
          </button>
          {caption(`#1–${hidden}`)}
        </div>
      )}
      {shown.map((attempt, index) => {
        const step = stepOf(attempt);
        const Icon = stepIcons[step];
        const name = `Attempt ${attempt.number}: ${word(attempt)}`;
        const picked = attempt.id === selected;
        const pulse = step === "printing" && "animate-pulse";
        return (
          <div key={attempt.id} className={thread(hidden > 0 ? index + 1 : index)}>
            <button
              type="button"
              title={name}
              aria-label={name}
              aria-current={picked ? "true" : undefined}
              onClick={() => onPick(attempt.id)}
              className={cn(
                "pressable focus-ring touch-target relative flex shrink-0 items-center justify-center rounded-full",
                desktop ? "size-7" : "size-12",
                // Without a photo (and always on desktop) a step is its outcome's soft disc and icon.
                (desktop || !attempt.photo) && (desktop && picked ? "bg-select text-on-select" : stepTones[step]),
              )}
            >
              {desktop || !attempt.photo ? (
                <Icon size={desktop ? 14 : 20} weight="bold" aria-hidden className={pulse || undefined} />
              ) : (
                <>
                  <span
                    aria-hidden
                    className={cn("absolute inset-0 rounded-full ring-2 ring-inset", stepRings[step])}
                  />
                  <span aria-hidden className="absolute inset-1">
                    <Photo
                      src={attempt.photo.src}
                      color={attempt.photo.color}
                      alt=""
                      className="size-full rounded-full"
                    />
                  </span>
                  <span
                    aria-hidden
                    className={cn(
                      "ring-paper absolute -right-0.5 -bottom-0.5 flex size-5 items-center justify-center rounded-full ring-2",
                      badgeTones[step],
                    )}
                  >
                    <Icon size={12} weight="bold" className={pulse || undefined} />
                  </span>
                </>
              )}
            </button>
            {caption(`#${attempt.number}`, picked)}
          </div>
        );
      })}
    </fieldset>
  );
}
