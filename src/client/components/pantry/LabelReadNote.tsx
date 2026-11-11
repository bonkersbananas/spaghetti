import type { Spool } from "@shared/api";
import { LABEL_FAILURE_LINES } from "@shared/label-read";
import { useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { SparkleIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { dismissLabelRead } from "@/lib/label-read";
import { requestLabelRead } from "@/lib/pantry";

const LabelSpoolsSheet = lazy(() => import("./LabelSpoolsSheet").then((m) => ({ default: m.LabelSpoolsSheet })));

/** "Reading the label…": a pulse, not a spinner. */
export function ReadingLine({ className }: { className?: string }) {
  return (
    <p className={cn("text-small text-ink-soft flex items-center gap-2", className)} role="status">
      <SparkleIcon size={16} weight="fill" aria-hidden className="sg-pulse shrink-0" />
      Reading the label…
    </p>
  );
}

interface LabelReadNoteProps {
  spool: Spool;
  readOnly: boolean;
  className?: string;
}

/**
 * Claude's label read on the spool's page: a calm line while it reads, one honest line with a retry when the label
 * couldn't be read, and, when the photo shows several spools, the way to look at the list before they are added.
 * Nothing when the read went fine (the fields say it themselves, marked "from the label").
 */
export function LabelReadNote({ spool, readOnly, className }: LabelReadNoteProps) {
  const queryClient = useQueryClient();
  const read = spool.labelRead;
  const [listing, setListing] = useState(false);
  // The list opens by itself when it arrives while someone is looking at the spool.
  const before = useRef(read?.status);
  useEffect(() => {
    if (read?.status === "multiple" && before.current === "reading") setListing(true);
    before.current = read?.status;
  }, [read?.status]);

  if (!read) return null;
  if (read.status === "reading") return <ReadingLine className={className} />;

  if (read.status === "multiple") {
    return (
      <div className={cn("flex flex-col items-start gap-2", className)}>
        <p className="text-small text-ink-soft flex items-center gap-2" role="status">
          <SparkleIcon size={16} weight="fill" aria-hidden className="shrink-0" />
          {read.spools.length} spools on this label
        </p>
        <Button variant="secondary" size="sm" disabled={readOnly} onClick={() => setListing(true)}>
          Review and add
        </Button>
        {listing && (
          <Suspense fallback={null}>
            <LabelSpoolsSheet spool={spool} open={listing} onOpenChange={setListing} />
          </Suspense>
        )}
      </div>
    );
  }

  return (
    <p className={cn("text-small text-ink-soft flex flex-wrap items-center gap-x-2", className)} role="status">
      {LABEL_FAILURE_LINES[read.status]}
      {read.status !== "cap" && (
        <Button
          variant="quiet"
          size="sm"
          disabled={readOnly}
          onClick={() => void requestLabelRead(queryClient, spool.id)}
        >
          Try again
        </Button>
      )}
      <Button variant="quiet" size="sm" onClick={() => void dismissLabelRead(queryClient, spool.id)}>
        Dismiss
      </Button>
    </p>
  );
}
