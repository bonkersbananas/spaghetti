import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { type PhotoRowSize, rowHover, rowSelected } from "./PhotoRow";

/**
 * A row with a button of its own ("Start again"): one card around both, so the button sits inside it and the card
 * takes the selected ring and the hover wash. The button stays beside the link, not in it (a button can't live inside
 * a link): under the words on a phone, at the right of the last line from md, where the row keeps `ACTION_ROOM` free.
 */
export function ActionCard({
  selected,
  action,
  size = "lg",
  children,
}: {
  selected?: boolean;
  action: ReactNode;
  /** The row's picture size, to line the button up with the words under it on a phone. */
  size?: PhotoRowSize;
  children: ReactNode;
}) {
  return (
    <div className={cn("relative rounded-lg", selected ? rowSelected : rowHover)}>
      {children}
      <div className={cn("flex pr-2 pb-3 md:absolute md:right-2 md:bottom-2 md:p-0", actionIndent[size])}>{action}</div>
    </div>
  );
}

/** Where a row's words start (padding, picture, gap), so a button under them lines up on a phone. */
const actionIndent: Record<PhotoRowSize, string> = { sm: "pl-[4.375rem]", md: "pl-[5.375rem]", lg: "pl-[6.375rem]" };

/**
 * The room the last line of a row in an `ActionCard` leaves at its right from md, for the button: `sm` for a short one
 * ("Start again"), `lg` for a longer one ("Start again with these"). Put it on the column of the row's words.
 */
export const ACTION_ROOM = { sm: "md:[&>*:last-child]:pr-32", lg: "md:[&>*:last-child]:pr-52" } as const;
