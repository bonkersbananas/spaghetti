import { cn } from "@/lib/cn";
import { NextIcon, PreviousIcon } from "./icons";

interface CardArrowsProps {
  index: number;
  count: number;
  onGo: (index: number) => void;
  /** The photo frame's aspect class, so the arrows sit over its middle. */
  className?: string;
}

/**
 * A card's previous and next photo arrows, for a mouse (a finger swipes, a trackpad scrolls): laid over the photo
 * beside the card's link, not inside it, so the link stays one control, and shown on hover. Keyboards see every photo
 * on the page the card opens. Lazy, from `Card`.
 */
export function CardArrows({ index, count, onGo, className }: CardArrowsProps) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-1.5 top-1.5 hidden items-center justify-between px-2 pointer-fine:flex",
        className,
      )}
    >
      {[
        { label: "Previous photo", Icon: PreviousIcon, to: index - 1 },
        { label: "Next photo", Icon: NextIcon, to: index + 1 },
      ].map(({ label, Icon, to }) => (
        <button
          key={label}
          type="button"
          tabIndex={-1}
          aria-hidden
          title={label}
          onClick={() => onGo(to)}
          className={cn(
            "pressable bg-veil text-on-veil shadow-raised duration-fast flex size-8 items-center justify-center rounded-full opacity-0 backdrop-blur-md transition-opacity",
            to >= 0 && to < count ? "pointer-events-auto group-hover/photos:opacity-100" : "invisible",
          )}
        >
          <Icon size={15} weight="bold" />
        </button>
      ))}
    </div>
  );
}
