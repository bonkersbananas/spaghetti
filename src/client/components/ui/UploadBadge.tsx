import { cn } from "@/lib/cn";
import { WarningIcon } from "./icons";

export type UploadBadgeState = "queued" | "processing" | "uploading" | "waiting";

interface UploadBadgeProps {
  state: UploadBadgeState;
  /** 0–1 while uploading. */
  progress?: number;
  className?: string;
}

/**
 * Sits on a photo that is still on its way to the server: a progress ring
 * while it uploads, and a plain "Not saved yet" while it waits to retry.
 */
export function UploadBadge({ state, progress = 0, className }: UploadBadgeProps) {
  const waiting = state === "waiting";
  return (
    <span
      role="status"
      className={cn(
        "rounded-pill text-caption inline-flex h-7 items-center gap-1.5 pr-2.5 pl-1.5 font-semibold backdrop-blur-md",
        waiting ? "bg-semolina-soft/95 text-semolina-ink" : "bg-ink/70 text-paper",
        className,
      )}
    >
      {waiting ? (
        <WarningIcon size={16} weight="bold" aria-hidden />
      ) : (
        <ProgressRing value={state === "uploading" ? progress : null} />
      )}
      {waiting ? "Not saved yet" : state === "uploading" ? `Saving ${Math.round(progress * 100)}%` : "Saving"}
    </span>
  );
}

/** A small ring: filled to `value` (0–1), or spinning when it isn't known. */
export function ProgressRing({ value, className }: { value: number | null; className?: string }) {
  const radius = 6;
  const circumference = 2 * Math.PI * radius;
  const shown = value === null ? 0.28 : Math.max(0.06, value);
  return (
    <svg
      viewBox="0 0 16 16"
      className={cn("size-4 -rotate-90", value === null && "animate-spin", className)}
      aria-hidden
    >
      <circle cx="8" cy="8" r={radius} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <circle
        cx="8"
        cy="8"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - shown)}
        className="duration-base transition-[stroke-dashoffset] ease-out"
      />
    </svg>
  );
}
