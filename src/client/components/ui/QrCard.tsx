import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { qrPath } from "@/lib/qr";

interface QrCardProps {
  /** What the code opens. */
  value: string;
  /** What the picture says to a screen reader: the code itself is no use to it. */
  label: string;
  className?: string;
}

/** A modules-wide quiet zone around the code: scanners want it. */
const QUIET = 3;

/**
 * A QR code on a card of its own, for the other device's camera. Always dark on light (tokens `qr-ink` and `qr-bg`),
 * in both themes. The code is drawn when it appears (lib/qr.ts loads the renderer then); until then the card is an
 * empty square of the same size, so nothing jumps.
 */
export function QrCard({ value, label, className }: QrCardProps) {
  const [qr, setQr] = useState<{ value: string; size: number; path: string } | null>(null);
  useEffect(() => {
    let live = true;
    void qrPath(value).then((made) => live && setQr({ value, ...made }));
    return () => {
      live = false;
    };
  }, [value]);
  const ready = qr?.value === value ? qr : null;
  return (
    <div className={cn("bg-qr-bg shadow-soft aspect-square w-full max-w-60 rounded-lg p-3", className)}>
      {ready ? (
        <svg
          role="img"
          aria-label={label}
          viewBox={`${-QUIET} ${-QUIET} ${ready.size + QUIET * 2} ${ready.size + QUIET * 2}`}
          className="size-full"
          shapeRendering="crispEdges"
        >
          <path d={ready.path} className="fill-qr-ink" />
        </svg>
      ) : (
        <div className="bg-paper-deep size-full animate-pulse rounded-md" aria-hidden />
      )}
    </div>
  );
}
