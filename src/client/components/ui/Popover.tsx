import * as RadixPopover from "@radix-ui/react-popover";
import { type ReactNode, type RefObject, useEffect, useRef } from "react";
import { cn } from "@/lib/cn";

interface PopoverPanelProps {
  children: ReactNode;
  /** Where it opens relative to its trigger, or its anchor (`PopoverAnchor`). */
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  /** A menu (18 rem), or a panel of settings (28 rem, with a sheet's bigger corners: a sheet's desktop twin). */
  size?: "menu" | "panel";
  className?: string;
  /** Accessible name for the popover. */
  label: string;
  /** What it hangs from (`PopoverAnchor`): using it (a card's Undo) leaves the popover open, as part of it. */
  keepOpenIn?: RefObject<HTMLElement | null>;
}

/** Closes the popover from inside it: wrap the item that was chosen (asChild). */
export const PopoverClose = RadixPopover.Close;

/**
 * The parts of a popover that hangs from more than its trigger: `PopoverRoot` around both, `PopoverAnchor` around
 * what it hangs from (a model's card, so it opens below the whole card and never over it), `PopoverTrigger` (asChild)
 * on the button inside, and the `PopoverPanel`.
 */
export const PopoverRoot = RadixPopover.Root;
export const PopoverAnchor = RadixPopover.Anchor;
export const PopoverTrigger = RadixPopover.Trigger;

/** A popover's floating panel, 8 px from what it opens from and at least 16 px from the window's edges. */
export function PopoverPanel({
  children,
  side = "top",
  align = "start",
  size = "menu",
  className,
  label,
  keepOpenIn,
}: PopoverPanelProps) {
  // Radix decides a press was outside only once it is a click, when the control pressed may be gone (an Undo that
  // undoes itself away): whether it began inside what the popover hangs from is noted as it begins.
  const pressedInside = useRef(false);
  useEffect(() => {
    if (!keepOpenIn) return;
    const note = (event: PointerEvent) => {
      pressedInside.current = !!keepOpenIn.current?.contains(event.target as Node);
    };
    document.addEventListener("pointerdown", note, true);
    return () => document.removeEventListener("pointerdown", note, true);
  }, [keepOpenIn]);
  return (
    <RadixPopover.Portal>
      <RadixPopover.Content
        side={side}
        align={align}
        sideOffset={8}
        // Clear of the window's edges, so it floats: its corners and shadow show, and its height stops short of them.
        collisionPadding={16}
        aria-label={label}
        onInteractOutside={(event) => {
          if (!keepOpenIn) return;
          const inside =
            event.detail.originalEvent.type === "pointerdown"
              ? pressedInside.current
              : !!keepOpenIn.current?.contains(event.target as Node);
          if (inside) event.preventDefault();
        }}
        className={cn(
          "sg-popover sg-lifted-surface bg-lifted shadow-float z-50 p-4 focus:outline-none",
          size === "panel" ? "w-md rounded-xl" : "w-72 rounded-lg",
          className,
        )}
      >
        {children}
      </RadixPopover.Content>
    </RadixPopover.Portal>
  );
}

interface PopoverProps extends Omit<PopoverPanelProps, "keepOpenIn"> {
  /** The element that opens it; must accept a ref and props (a button). */
  trigger: ReactNode;
  /** Controlled: whether it is open, and the change to make (a menu whose code may arrive after its trigger was pressed). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/** A small floating panel for desktop menus (the account menu). Sheets are for tasks; this is for settings at hand. */
export function Popover({ trigger, children, open, onOpenChange, ...panel }: PopoverProps) {
  return (
    <RadixPopover.Root open={open} onOpenChange={onOpenChange}>
      <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
      <PopoverPanel {...panel}>{children}</PopoverPanel>
    </RadixPopover.Root>
  );
}
