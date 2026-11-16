import { cn } from "@/lib/cn";
import { MoreIcon } from "./icons";

/**
 * The "…" on a thumbnail's bottom corner that says it has a menu (an idea's strip: Make cover, Remove): `shown` on the
 * photo showing, and with a mouse on any thumbnail under it (its parent is `group/thumb`). It is for the pointer
 * only; the thumbnail itself opens the menu for the keyboard and screen readers (a second press), so it stays out of
 * the tab order and the accessibility tree.
 */
export function PhotoMenuDot({ shown, onClick }: { shown: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-hidden
      title="More for this photo"
      onClick={onClick}
      className={cn(
        "pressable bg-veil text-on-veil duration-fast absolute right-1 bottom-1 flex size-6 items-center justify-center rounded-full backdrop-blur-md transition-opacity",
        shown
          ? "opacity-100"
          : "pointer-events-none opacity-0 group-hover/thumb:pointer-events-auto group-hover/thumb:opacity-100",
      )}
    >
      <MoreIcon size={14} weight="bold" />
    </button>
  );
}
