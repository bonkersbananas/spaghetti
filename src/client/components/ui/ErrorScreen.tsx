import { useEffect, useState } from "react";
import { TangledPot } from "@/components/illustrations/TangledPot";
import { reloadIntoNewBuild } from "@/lib/stale-build";
import { Button } from "./Button";
import { CheckIcon, CopyIcon, ExpandIcon } from "./icons";

interface ErrorScreenProps {
  error: unknown;
  /** Tries the screen again without reloading, when the router offers it. */
  reset?: () => void;
  /** Styleguide only: show the "newer version" wording. The router passes just the error. */
  updating?: boolean;
  className?: string;
}

const messageOf = (error: unknown) => {
  if (error instanceof Error) return error.message || error.name;
  return typeof error === "string" ? error : "Unknown error";
};

/**
 * What shows when a screen fails to load or crashes: calm, one clear action (Reload), the technical message
 * tucked behind "Details" with Copy rather than shouted. Used by the router (lib/router-error.tsx), loaded lazily.
 */
/** A chunk of this build is gone (a deploy happened): the app reloads itself into the new one, once. */
const isChunkError = (error: unknown) =>
  /dynamically imported module|importing a module script|not a valid javascript mime|Unable to preload/i.test(
    String((error as Error | undefined)?.message ?? error),
  );

export default function ErrorScreen({ error, reset, updating: forced = false, className }: ErrorScreenProps) {
  const [copied, setCopied] = useState(false);
  const message = messageOf(error);
  const stale = isChunkError(error);
  // Says "a fresh batch" only once a reload has really started: with no new build out (offline, or a guard that has
  // just spent itself) the plain screen, with Try again, is the honest one.
  const [reloading, setReloading] = useState(false);
  const updating = forced || reloading;
  useEffect(() => {
    if (stale) void reloadIntoNewBuild().then(setReloading);
  }, [stale]);
  return (
    <div
      className={
        className ?? "bg-paper text-ink flex min-h-dvh flex-col items-center justify-center px-6 py-12 text-center"
      }
    >
      <TangledPot className="mb-5" />
      <h1 className="text-headline text-ink max-w-sm">{updating ? "A fresh batch is ready" : "That got tangled"}</h1>
      <p className="text-body text-ink-soft mt-2 max-w-sm">
        {updating
          ? "Spaghetti has been updated since this screen opened. One moment while it reloads."
          : "Nothing you saved is lost. Reload, and it should untangle."}
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Button variant="primary" onClick={() => location.reload()}>
          Reload
        </Button>
        {reset && !updating && (
          <Button variant="quiet" onClick={reset}>
            Try again
          </Button>
        )}
      </div>
      <details className="text-small text-ink-faint mt-8 w-full max-w-sm text-left">
        <summary className="focus-ring text-small text-ink-faint hover:text-ink group mx-auto flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-xs py-2 font-medium [&::-webkit-details-marker]:hidden">
          Details
          <ExpandIcon
            size={16}
            weight="bold"
            className="duration-base transition-transform ease-out group-open:rotate-180"
            aria-hidden
          />
        </summary>
        <pre className="bg-ink/3 text-ink-soft mt-2 rounded-lg p-3 text-xs break-words whitespace-pre-wrap">
          {message}
        </pre>
        <div className="mt-2 flex justify-center">
          <Button
            size="sm"
            variant="quiet"
            icon={copied ? CheckIcon : CopyIcon}
            onClick={() => {
              void navigator.clipboard?.writeText(message).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? "Copied" : "Copy details"}
          </Button>
        </div>
      </details>
    </div>
  );
}
