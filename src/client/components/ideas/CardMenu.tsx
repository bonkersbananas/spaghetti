import { type ReactNode, useState } from "react";
import { MoreIcon, MoveDownIcon, MoveUpIcon, UpNextIcon } from "@/components/ui/icons";
import { Popover, PopoverClose } from "@/components/ui/Popover";
import { Sheet } from "@/components/ui/Sheet";
import { useIsDesktop } from "@/lib/use-media-query";
import type { UpNextMenu } from "./IdeaCard";

/** The card's "…" button: Up next, and where it stands in the queue. A link can't hold a button, so it sits over the card. */
export function CardMenu({ menu, name }: { menu: UpNextMenu; name: string }) {
  const isDesktop = useIsDesktop();
  const [open, setOpen] = useState(false);
  const row =
    "text-body text-ink hover:bg-ink/5 focus-visible:bg-ink/5 flex min-h-12 w-full items-center gap-3 rounded-md px-3 text-left outline-none md:min-h-11";
  const actions = (
    <div className="flex flex-col">
      <MenuRow onSelect={menu.onToggle} className={row} close={isDesktop ? undefined : () => setOpen(false)}>
        <UpNextIcon size={20} aria-hidden />
        {menu.queued ? "Take off Up next" : "Up next"}
      </MenuRow>
      {menu.onMoveUp && (
        <MenuRow onSelect={menu.onMoveUp} className={row} close={isDesktop ? undefined : () => setOpen(false)}>
          <MoveUpIcon size={20} aria-hidden />
          Move up
        </MenuRow>
      )}
      {menu.onMoveDown && (
        <MenuRow onSelect={menu.onMoveDown} className={row} close={isDesktop ? undefined : () => setOpen(false)}>
          <MoveDownIcon size={20} aria-hidden />
          Move down
        </MenuRow>
      )}
    </div>
  );
  // Over the card's bottom-right corner, at the end of the avatar's row: the photo and a note's words stay clear.
  const button = (
    <button
      type="button"
      aria-label={`Options for ${name}`}
      onClick={isDesktop ? undefined : () => setOpen(true)}
      className="pressable focus-ring touch-target text-ink-faint hover:bg-ink/5 hover:text-ink absolute right-1 bottom-1 flex size-10 items-center justify-center rounded-full transition-colors"
    >
      <MoreIcon size={20} weight="bold" aria-hidden />
    </button>
  );
  if (!isDesktop) {
    return (
      <>
        {button}
        <Sheet open={open} onOpenChange={setOpen} title={name} description="Up next, the queue of what to print soon.">
          {actions}
        </Sheet>
      </>
    );
  }
  return (
    <Popover label={`Up next options for ${name}`} side="bottom" align="end" className="w-56 p-1.5" trigger={button}>
      {actions}
    </Popover>
  );
}

/** One action in the menu; on desktop the popover closes around it, on phones the sheet is closed by hand. */
function MenuRow({
  onSelect,
  close,
  className,
  children,
}: {
  onSelect: () => void;
  close?: () => void;
  className: string;
  children: ReactNode;
}) {
  const button = (
    <button
      type="button"
      className={className}
      onClick={() => {
        onSelect();
        close?.();
      }}
    >
      {children}
    </button>
  );
  return close ? button : <PopoverClose asChild>{button}</PopoverClose>;
}
