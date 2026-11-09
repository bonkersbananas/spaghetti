import { useState } from "react";
import { cn } from "@/lib/cn";

export interface PhotoProps {
  src: string;
  alt: string;
  /** The photo's average color (#rrggbb), shown until the pixels arrive. */
  color?: string;
  /** "cover" fills the frame (grids); "contain" shows the whole print (viewer). */
  fit?: "cover" | "contain";
  eager?: boolean;
  className?: string;
  imgClassName?: string;
}

/**
 * A photo in a frame: its own color while it loads, then a quick fade. The
 * frame decides the size; the image never shifts the layout.
 */
export function Photo({ src, alt, color, fit = "cover", eager, className, imgClassName }: PhotoProps) {
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const loaded = loadedSrc === src;
  return (
    <div
      className={cn("bg-well relative overflow-hidden", className)}
      // The photo's own color is data, not design.
      style={color && !loaded ? { backgroundColor: color } : undefined} // design-lint-ignore
    >
      <img
        // Decoded already (cached, or a local preview): no fade needed.
        ref={(img) => {
          if (img?.complete && img.naturalWidth > 0 && loadedSrc !== img.src) setLoadedSrc(src);
        }}
        src={src}
        alt={alt}
        draggable={false}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        onLoad={() => setLoadedSrc(src)}
        className={cn(
          "duration-base size-full transition-opacity ease-out",
          fit === "cover" ? "object-cover" : "object-contain",
          loaded ? "opacity-100" : "opacity-0",
          imgClassName,
        )}
      />
    </div>
  );
}
