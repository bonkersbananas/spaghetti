import { type ReactNode, useState } from "react";
import { IconButton } from "@/components/ui/Button";
import { CompareIcon, MoreIcon, RecipeIcon } from "@/components/ui/icons";
import { Popover, PopoverClose } from "@/components/ui/Popover";
import { Sheet } from "@/components/ui/Sheet";
import { useIsDesktop } from "@/lib/use-media-query";

interface AttemptMenuProps {
  number: number;
  /** With an attempt before it: compare the two. */
  onCompare?: () => void;
  /** An attempt that worked and isn't a recipe yet. */
  onSaveRecipe?: () => void;
  /** Whether the attempt differs from the one before it ("Compare") or not ("Compare with attempt 2"). */
  changed: boolean;
}

const row =
  "text-body text-ink hover:bg-ink/5 focus-visible:bg-ink/5 flex min-h-12 w-full items-center gap-3 rounded-md px-3 text-left outline-none md:min-h-11";

/**
 * The attempt card's "…": the quiet extras (compare with the attempt before, keep it as a recipe) behind one button,
 * so the card itself keeps to how it went, the picture and the note. A popover on desktop, a sheet on phones.
 */
export function AttemptMenu({ number, onCompare, onSaveRecipe, changed }: AttemptMenuProps) {
  const isDesktop = useIsDesktop();
  const [open, setOpen] = useState(false);
  // Mounted with the first tap, so a long story doesn't carry a closed sheet per attempt.
  const [asked, setAsked] = useState(false);
  if (!onCompare && !onSaveRecipe) return null;
  const label = `Options for attempt ${number}`;
  const rows = (close?: () => void) => (
    <div className="flex flex-col">
      {onCompare && (
        <Row onSelect={onCompare} close={close}>
          <CompareIcon size={20} aria-hidden />
          {changed ? "Compare" : `Compare with attempt ${number - 1}`}
        </Row>
      )}
      {onSaveRecipe && (
        <Row onSelect={onSaveRecipe} close={close}>
          <RecipeIcon size={20} aria-hidden />
          Save as recipe
        </Row>
      )}
    </div>
  );
  const trigger = (
    <IconButton
      icon={MoreIcon}
      label={label}
      size="sm"
      className="relative -mr-1.5"
      onClick={
        isDesktop
          ? undefined
          : () => {
              setAsked(true);
              setOpen(true);
            }
      }
    />
  );
  if (isDesktop) {
    return (
      <Popover label={label} side="bottom" align="end" className="w-60 p-1.5" trigger={trigger}>
        {rows()}
      </Popover>
    );
  }
  return (
    <>
      {trigger}
      {asked && (
        <Sheet open={open} onOpenChange={setOpen} title={`Attempt ${number}`}>
          {rows(() => setOpen(false))}
        </Sheet>
      )}
    </>
  );
}

/** One action: on desktop the popover closes around it, on phones the sheet is closed by hand. */
function Row({ onSelect, close, children }: { onSelect: () => void; close?: () => void; children: ReactNode }) {
  const button = (
    <button
      type="button"
      className={row}
      onClick={() => {
        close?.();
        onSelect();
      }}
    >
      {children}
    </button>
  );
  return close ? button : <PopoverClose asChild>{button}</PopoverClose>;
}
