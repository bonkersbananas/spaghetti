import { type ComponentPropsWithRef, forwardRef, type MouseEvent } from "react";
import { cn } from "@/lib/cn";
import { prefetchLarge } from "./open-large";

export { openLarge, prefetchLarge } from "./open-large";

/**
 * A photo that opens large when pressed: a button around the picture, with a zoom cursor on desktop and the press
 * every tile has. Its `onClick` calls `openLarge` (ui/open-large.ts); its label says which photo.
 */
export const OpenLarge = forwardRef<HTMLButtonElement, ComponentPropsWithRef<"button"> & { label: string }>(
  function OpenLarge({ label, className, children, ...props }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        aria-label={label}
        onPointerEnter={prefetchLarge}
        onFocus={prefetchLarge}
        onTouchStart={prefetchLarge}
        className={cn("pressable focus-ring block cursor-zoom-in overflow-hidden", className)}
        {...props}
      >
        {children}
      </button>
    );
  },
);
