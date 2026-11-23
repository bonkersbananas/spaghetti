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
  /**
   * The frame behind a photo that doesn't fill it: "well" (default), the deeper paper of a viewer ("deep"), or
   * "render" for a slicer's plate picture: its own ground in both themes, the model casting a faint shadow on it;
   * "render-tile" for one in a small tile (48 px and under), on a deeper ground with a firmer edge.
   */
  frame?: "well" | "deep" | "render" | "render-tile";
  /**
   * With `fit="contain"`: the picture's own colours, blurred, fill what the print leaves bare, so a tall photo in a
   * wide frame sits on a soft glow, not between two flat bars.
   */
  glow?: boolean;
  /**
   * A smaller copy that is likely on hand already (the thumbnail a card showed): drawn at once under the picture until
   * it arrives, so a photo opened large shows something real at once instead of its color.
   */
  preview?: string;
  className?: string;
  imgClassName?: string;
}

const frames = {
  well: "bg-well",
  deep: "bg-paper-deep",
  render: "bg-render",
  "render-tile": "bg-render-tile",
} as const;

/** Pictures this page has already shown: back on a screen they are there at once, no placeholder and fade again. */
const shown = new Set<string>();

/**
 * A photo in a frame: its own color while it loads, then a quick fade. The
 * frame decides the size; the image never shifts the layout.
 */
export function Photo({
  src,
  alt,
  color,
  fit = "cover",
  eager,
  frame = "well",
  glow,
  preview,
  className,
  imgClassName,
}: PhotoProps) {
  const [loadedSrc, setLoadedSrc] = useState<string | null>(() => (shown.has(src) ? src : null));
  const loaded = loadedSrc === src;
  // Known when the frame first drew this picture: it shows without the fade (a picture that arrives later fades in).
  const [first] = useState(() => ({ src, seen: shown.has(src) }));
  const seen = first.src === src && first.seen;
  return (
    <div
      className={cn(frames[frame], "relative overflow-hidden", className)}
      // The photo's own color is data, not design.
      style={color && !loaded ? { backgroundColor: color } : undefined} // design-lint-ignore
    >
      {preview && !loaded && !seen && (
        <img
          src={preview}
          alt=""
          aria-hidden
          draggable={false}
          decoding="async"
          className={cn("absolute inset-0 size-full", fit === "cover" ? "object-cover" : "object-contain")}
        />
      )}
      {glow && fit === "contain" && (
        <img
          src={src}
          alt=""
          aria-hidden
          draggable={false}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          className={cn(
            "absolute inset-0 size-full scale-125 object-cover opacity-0 blur-2xl",
            loaded && "duration-slow opacity-50 transition-opacity",
          )}
        />
      )}
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
          "relative size-full ease-out",
          !seen && "duration-base transition-opacity",
          fit === "cover" ? "object-cover" : "object-contain",
          frame === "render" && "render-shadow",
          frame === "render-tile" && "render-shadow-tile",
          loaded ? "opacity-100" : "opacity-0",
          imgClassName,
        )}
      />
    </div>
  );
}
