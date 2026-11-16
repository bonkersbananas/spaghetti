import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Dragging a card to another place in its row (desktop, with a mouse). */
export interface CardDrag {
  dragging: boolean;
  over: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: () => void;
  onDrop: () => void;
}

/**
 * What a card sits in so a mouse can drag it to another place in its row (Up next): it fades while it moves and the
 * card it would land on shows a ring. Without `drag` it is a plain box. Keyboards and phones move cards from the
 * card's menu (Move up, Move down) or with [ and ].
 */
export function DragFrame({
  drag,
  id,
  className,
  children,
}: {
  drag?: CardDrag;
  /** What the drag carries: a card dropped outside the page drops as this text. */
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: dragging is a mouse extra; the card's menu has Move up and Move down for keyboards and phones.
    <div
      draggable={!!drag}
      onDragStart={
        drag
          ? (event) => {
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", id ?? "");
              drag.onDragStart();
            }
          : undefined
      }
      onDragEnd={drag?.onDragEnd}
      onDragOver={
        drag
          ? (event) => {
              event.preventDefault();
              drag.onDragOver();
            }
          : undefined
      }
      onDrop={
        drag
          ? (event) => {
              event.preventDefault();
              drag.onDrop();
            }
          : undefined
      }
      className={cn("h-full rounded-lg", drag?.dragging && "opacity-40", drag?.over && "ring-tomato ring-2", className)}
    >
      {children}
    </div>
  );
}
