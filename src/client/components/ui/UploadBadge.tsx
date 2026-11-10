import { cn } from "@/lib/cn";
import { WarningIcon } from "./icons";
import { ProgressRing } from "./ProgressRing";

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
        waiting ? "bg-semolina-soft/95 text-semolina-ink" : "bg-veil-strong text-on-veil",
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
