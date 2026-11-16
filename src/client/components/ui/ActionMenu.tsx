import { createContext, type ReactNode, type RefObject, use, useState } from "react";
import { cn } from "@/lib/cn";
import { useIsDesktop } from "@/lib/use-media-query";
import { IconButton } from "./Button";
import { type Icon, MoreIcon } from "./icons";
import { PopoverAnchor, PopoverPanel, PopoverRoot, PopoverTrigger } from "./Popover";
import { Sheet } from "./Sheet";

/** Closes the menu around the row that was chosen. */
const CloseContext = createContext<() => void>(() => {});

/** Something a popover can hang from: an element, or a point (a right click). */
export interface MenuAnchor {
  getBoundingClientRect: () => DOMRect;
}

interface ActionMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The sheet's title on phones ("Photo 2"); also names the popover on desktop. */
  title: string;
  /** What it hangs from on desktop: the thumbnail it was opened on. */
  anchor?: RefObject<MenuAnchor | null>;
  /** Where focus goes when it closes (it was opened without a trigger: a long press, a second tap). */
  returnFocus?: RefObject<HTMLElement | null>;
  /** In a sheet already: a popover on phones too, never a sheet over a sheet. */
  inSheet?: boolean;
  children: ReactNode;
}

/**
 * The rare actions on a thing, out of the way of its common ones: a sheet on phones (under the thumb) and a small
 * popover on desktop. Its rows are `ActionMenuItem`s; one that removes is `tone="danger"`, last. This one is opened
 * by its owner (a long press, a second tap, a right click); `MoreMenu` is the same behind its own "…" button.
 */
export function ActionMenu({ open, onOpenChange, title, anchor, returnFocus, inSheet, children }: ActionMenuProps) {
  const isDesktop = useIsDesktop();
  const close = () => onOpenChange(false);
  const rows = (
    <CloseContext value={close}>
      <div className="flex flex-col">{children}</div>
    </CloseContext>
  );
  if (!isDesktop && !inSheet) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange} title={title}>
        {rows}
      </Sheet>
    );
  }
  return (
    <PopoverRoot open={open} onOpenChange={onOpenChange}>
      {anchor && <PopoverAnchor virtualRef={anchor as RefObject<MenuAnchor>} />}
      <PopoverPanel
        label={title}
        side="bottom"
        align="start"
        className="w-56 p-1.5"
        onCloseAutoFocus={(event) => {
          if (!returnFocus?.current) return;
          event.preventDefault();
          returnFocus.current.focus({ preventScroll: true });
        }}
      >
        {rows}
      </PopoverPanel>
    </PopoverRoot>
  );
}

interface MoreMenuProps {
  /** The button's accessible name: "More for desk-clips.3mf". */
  label: string;
  /** The sheet's title on phones. */
  title: string;
  inSheet?: boolean;
  /** Placed where its row needs it (the end of a card's actions). */
  className?: string;
  children: ReactNode;
}

/** An `ActionMenu` behind a quiet "…" button: a popover from it on desktop, a sheet on phones. */
export function MoreMenu({ label, title, inSheet, className, children }: MoreMenuProps) {
  const isDesktop = useIsDesktop();
  const [open, setOpen] = useState(false);
  // A closed phone sheet still costs a vaul root: mounted with the first tap, kept afterwards so it closes smoothly.
  const [asked, setAsked] = useState(false);
  const button = (
    <IconButton
      icon={MoreIcon}
      label={label}
      aria-haspopup="dialog"
      aria-expanded={open}
      className={className}
      onClick={
        isDesktop || inSheet
          ? undefined
          : () => {
              setAsked(true);
              setOpen(true);
            }
      }
    />
  );
  if (isDesktop || inSheet) {
    return (
      <PopoverRoot open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>{button}</PopoverTrigger>
        <PopoverPanel label={title} side="bottom" align="end" className="w-56 p-1.5">
          <CloseContext value={() => setOpen(false)}>
            <div className="flex flex-col">{children}</div>
          </CloseContext>
        </PopoverPanel>
      </PopoverRoot>
    );
  }
  return (
    <>
      {button}
      {asked && (
        <ActionMenu open={open} onOpenChange={setOpen} title={title}>
          {children}
        </ActionMenu>
      )}
    </>
  );
}

interface ActionMenuItemProps {
  icon: Icon;
  onSelect: () => void;
  /** Removes or deletes: tomato words, and the last row. */
  tone?: "danger";
  children: ReactNode;
}

/** One row of an `ActionMenu`: the menu closes, then it acts. */
export function ActionMenuItem({ icon: IconComponent, onSelect, tone, children }: ActionMenuItemProps) {
  const close = use(CloseContext);
  return (
    <button
      type="button"
      onClick={() => {
        close();
        onSelect();
      }}
      className={cn(
        "pressable focus-ring text-body hover:bg-ink/5 flex min-h-12 w-full items-center gap-3 rounded-md px-3 text-left md:min-h-11",
        tone === "danger" ? "text-tomato-ink" : "text-ink",
      )}
    >
      <IconComponent size={20} aria-hidden />
      {children}
    </button>
  );
}
