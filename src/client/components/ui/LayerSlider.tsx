import { cn } from "@/lib/cn";

interface LayerSliderProps {
  /** Names it for screen readers: "Layer". */
  label: string;
  /** 0 … `max`. */
  value: number;
  max: number;
  onChange: (value: number) => void;
  /** What a screen reader says for the value: "Layer 112 of 240, 13.4 mm". */
  valueText: string;
  /** A print in progress: the layer it has reached, marked on the track. */
  live?: number | null;
  /** A word under the live mark ("now"), so the mark says what it is. */
  liveLabel?: string;
  className?: string;
}

/**
 * A slider you scrub with a thumb: a recessed track that fills to the thumb and a round, lifted handle in a 44 px
 * target. A real range input underneath, so arrow keys, Home/End, Page keys and screen readers work as they should.
 * Used under the 3D view to pick the layer; `live` marks how far a running print has got.
 */
export function LayerSlider({ label, value, max, onChange, valueText, live, liveLabel, className }: LayerSliderProps) {
  const at = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const liveAt = live != null && max > 0 ? Math.min(1, Math.max(0, live / max)) : null;
  return (
    <div className={cn("relative", liveAt !== null && liveLabel && "pb-2.5", className)} data-vaul-no-drag>
      <input
        type="range"
        min={0}
        max={max}
        step={1}
        value={value}
        aria-label={label}
        aria-valuetext={valueText}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        className="sg-slider focus-visible:outline-none"
        style={{ "--sg-slider-at": at } as React.CSSProperties}
      />
      {liveAt !== null && live !== value && (
        // Hidden under the handle when it rests on the mark, where it would read as a scratch on it.
        <span
          aria-hidden
          className="sg-slider-live bg-semolina pointer-events-none absolute top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full"
          style={{ left: `calc(0.875rem + (100% - 1.75rem) * ${liveAt})` }}
        />
      )}
      {liveAt !== null && liveLabel && (
        // Under the mark, clear of the handle when it rests there.
        <span
          aria-hidden
          className="text-caption text-semolina-ink pointer-events-none absolute top-9 -translate-x-1/2 leading-none font-semibold"
          style={{ left: `calc(0.875rem + (100% - 1.75rem) * ${liveAt})` }}
          data-live-label
        >
          {liveLabel}
        </span>
      )}
    </div>
  );
}
