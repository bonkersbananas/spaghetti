import { m, useReducedMotion, useTransform } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { PULL_THRESHOLD, usePullToGo } from "@/lib/pull-to-go";
import { ExpandIcon } from "./icons";

interface PullToGoProps {
  /** Where the pull goes with no page before it in the app: the list this kind of page belongs to. */
  back: { to: string; label: string };
  children: ReactNode;
  className?: string;
}

/** The words that appear in the gap a pull opens: the place it goes to, and "Release for …" once letting go will go there. */
export function PullHint({ label, ready }: { label: string; ready: boolean }) {
  return (
    <span
      className={cn(
        "rounded-pill text-small shadow-soft flex h-9 items-center gap-1.5 pr-4 pl-2.5 font-semibold",
        ready ? "bg-ink text-cream" : "bg-paper-deep text-ink",
      )}
    >
      <ExpandIcon size={18} weight="bold" />
      {ready ? `Release for ${label}` : label}
    </span>
  );
}

/**
 * A page you can close by pulling it down at its very top, on phones: it follows the finger with growing
 * resistance, a quiet name appears in the gap it leaves ("Release for Today" once a release would go
 * back), and past the threshold (or a quick flick) it slides away and the page before shows where you left it
 * (the list, with no page before).
 * Under the threshold it springs back. Only a vertical pull at scroll 0 that starts on the page's own
 * content counts: sideways drags, fields, sheets and inner scrollers keep their own touches. With reduced
 * motion the page stays put, the words still change, and it fades away.
 */
export function PullToGo({ back, children, className }: PullToGoProps) {
  const reduced = !!useReducedMotion();
  const { offset, ready, pulling, leave, label } = usePullToGo(back, reduced);
  const shown = useTransform(offset, [14, PULL_THRESHOLD * 0.7], [0, 1]);
  const lift = useTransform(offset, (value) => value / 2 - 18);
  return (
    <>
      <m.div
        aria-hidden
        data-pull-hint={pulling ? (ready ? "ready" : "pulling") : undefined}
        style={{ opacity: reduced ? (pulling ? 1 : 0) : shown, y: reduced ? 0 : lift }}
        className="pointer-events-none fixed inset-x-0 top-[var(--sg-safe-top)] z-10 flex justify-center md:hidden"
      >
        <PullHint label={label} ready={ready} />
      </m.div>
      <m.div style={{ y: offset, opacity: leave }} className={className}>
        {children}
      </m.div>
    </>
  );
}
