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
        "bg-veil-strong text-on-veil ring-on-veil/70 shadow-raised relative m-2.5 flex size-13 rotate-[-6deg] flex-col items-center justify-center rounded-full ring-2 backdrop-blur-md",
        className,
      )}
    >
      <ModelIcon size={24} weight="fill" aria-hidden />
      <span className="text-caption -mt-0.5 leading-none font-semibold" aria-hidden>
        {modelLetter(mark)}
      </span>
      <span
        aria-hidden
        className="bg-basil text-on-veil ring-on-veil/70 absolute -top-1 -right-1 flex size-5 items-center justify-center rounded-full ring-2"
      >
        <CheckIcon size={11} weight="bold" />
      </span>
      <span className="sr-only">Ready to print, model on {modelPlace(mark)}</span>
    </span>
  );
}
