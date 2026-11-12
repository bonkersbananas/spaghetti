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
  /** The frame behind a photo that doesn't fill it: "well" (default) or the deeper paper of a viewer ("deep"). */
  frame?: "well" | "deep";
  className?: string;
  imgClassName?: string;
}

/** Pictures this page has already shown: back on a screen they are there at once, no placeholder and fade again. */
const shown = new Set<string>();

/**
 * A photo in a frame: its own color while it loads, then a quick fade. The
 * frame decides the size; the image never shifts the layout.
 */
export function Photo({ src, alt, color, fit = "cover", eager, frame = "well", className, imgClassName }: PhotoProps) {
  const [loadedSrc, setLoadedSrc] = useState<string | null>(() => (shown.has(src) ? src : null));
  const loaded = loadedSrc === src;
  // Known when the frame first drew this picture: it shows without the fade (a picture that arrives later fades in).
  const [first] = useState(() => ({ src, seen: shown.has(src) }));
  const seen = first.src === src && first.seen;
  return (
    <div
      className={cn(frame === "deep" ? "bg-paper-deep" : "bg-well", "relative overflow-hidden", className)}
      // The photo's own color is data, not design.
      style={color && !loaded ? { backgroundColor: color } : undefined} // design-lint-ignore
    >
      <img
        // Decoded already (cached, or a local preview): no fade needed.
        ref={(img) => {
          if (img?.complete && img.naturalWidth > 0 && loadedSrc !== img.src) {
            shown.add(src);
            setLoadedSrc(src);
          }
        }}
        src={src}
        alt={alt}
        draggable={false}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        onLoad={() => {
          shown.add(src);
          setLoadedSrc(src);
        }}
        className={cn(
          "size-full ease-out",
          !seen && "duration-base transition-opacity",
          fit === "cover" ? "object-cover" : "object-contain",
          loaded ? "opacity-100" : "opacity-0",
          imgClassName,
        )}
      />
    </div>
  );
}
