import { cn } from "@/lib/cn";

interface KbdProps {
  /** One or more keys, shown as separate caps: ["G", "I"]. */
  keys: string[];
  /** "onAccent" for use on a tomato button. */
  tone?: "default" | "onAccent";
  className?: string;
}

/** A keyboard hint. Desktop only: hidden on phones, which have no keyboard. */
export function Kbd({ keys, tone = "default", className }: KbdProps) {
  return (
    <span className={cn("hidden items-center gap-0.5 md:inline-flex", className)} aria-hidden>
      {keys.map((key) => (
        <kbd
          key={key}
          className={cn(
            "text-caption inline-flex h-5 min-w-5 items-center justify-center rounded-xs px-1 font-sans font-semibold",
            tone === "onAccent" ? "bg-on-accent/20 text-on-accent" : "bg-ink/6 text-ink-faint",
          )}
        >
          {key}
        </kbd>
      ))}
    </span>
  );
}
