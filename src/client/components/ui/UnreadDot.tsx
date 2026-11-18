import { cn } from "@/lib/cn";

/**
 * One quiet dot: something the other person wrote waits here. It is the small sibling of `UnreadBadge` (which counts,
 * on a card's photo) for places with no room for words: a tab, a sidebar item, a strip's card. Never a count. Say
 * what it means to a screen reader with `label`, or leave it out where a sibling already says it.
 * `ring` is the surface it sits on, so the dot reads as cut out of it; over a photo it is `ring-on-veil` (the same cream in both themes, like everything drawn over photos).
 */
export function UnreadDot({
  label,
  ring = "ring-cream",
  className,
}: {
  label?: string;
  ring?: "ring-cream" | "ring-paper" | "ring-paper-deep" | "ring-on-veil";
  className?: string;
}) {
  return (
    <span data-unread-dot className={cn("bg-tomato size-2 shrink-0 rounded-full ring-2", ring, className)}>
      {label && <span className="sr-only">{label}</span>}
    </span>
  );
}
