import * as RadixPopover from "@radix-ui/react-popover";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface PopoverProps {
  /** The element that opens it; must accept a ref and props (a button). */
  trigger: ReactNode;
  children: ReactNode;
  /** Where it opens relative to the trigger. */
  side?: "top" | "right" | "bottom" | "left";
  align?: "start" | "center" | "end";
  className?: string;
  /** Accessible name for the popover. */
  label: string;
}

/** A small floating panel for desktop menus (the account menu). Sheets are for tasks; this is for settings at hand. */
export function Popover({ trigger, children, side = "top", align = "start", className, label }: PopoverProps) {
  return (
    <RadixPopover.Root>
      <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          side={side}
          align={align}
          sideOffset={8}
          aria-label={label}
          className={cn("sg-popover bg-lifted shadow-float z-50 w-72 rounded-lg p-4 focus:outline-none", className)}
        >
          {children}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
