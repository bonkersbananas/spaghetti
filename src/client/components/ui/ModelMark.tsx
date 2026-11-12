import { type ModelMark as Model, modelLetter, modelPlace } from "@shared/model-mark";
import { cn } from "@/lib/cn";
import { CheckIcon, ModelIcon } from "./icons";

/**
 * "There is a model for this idea, ready to print": a round sticker stuck on a card photo's bottom right corner
 * (Card's `mark` slot), tilted a little like a label on a recipe card. Dark glass with a cream edge (veil / on-veil:
 * a photo is the same photo at night), the model icon over the site's letter ("M", "STL"), and a basil tick as the
 * accent that says it's ready. Chosen over a "Ready to print" pill (wraps and truncates on a half-width phone card,
 * covers more of the photo) and a corner tab (truncated too); see docs/design.md.
 */
export function ModelMark({ mark, className }: { mark: Model; className?: string }) {
  return (
    <span
      className={cn(
        "bg-veil-strong text-on-veil ring-on-veil/70 shadow-raised relative m-1.5 flex size-9 rotate-[-6deg] flex-col items-center justify-center rounded-full ring-1 backdrop-blur-md md:m-2.5 md:size-13 md:ring-2",
        className,
      )}
    >
      <ModelIcon weight="fill" aria-hidden className="size-4 md:size-6" />
      <span className="text-micro md:text-caption -mt-px leading-none font-semibold md:-mt-0.5" aria-hidden>
        {modelLetter(mark)}
      </span>
      <span
        aria-hidden
        className="bg-basil text-on-veil ring-on-veil/70 absolute -top-0.5 -right-0.5 flex size-3.5 items-center justify-center rounded-full ring-1 md:-top-1 md:-right-1 md:size-5 md:ring-2"
      >
        <CheckIcon weight="bold" className="size-2 md:size-3" />
      </span>
      <span className="sr-only">Ready to print, model on {modelPlace(mark)}</span>
    </span>
  );
}
