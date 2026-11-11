import { useQueryClient } from "@tanstack/react-query";
import { itemName } from "@/components/journal/JournalEntry";
import { Button } from "@/components/ui/Button";
import { PickTile } from "@/components/ui/RankRow";
import { Sheet } from "@/components/ui/Sheet";
import type { ItemView } from "@/lib/items";
import { photoSrc } from "@/lib/previews";
import { useReadOnly } from "@/lib/read-only";
import { toggleWishlist } from "@/lib/wishlist";

interface WishPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  me: string;
  /** Every idea, in the inbox's order, so tiles stay put while you pick. */
  ideas: ItemView[];
  /** Your list, top first. */
  picked: string[];
}

/** Your list's ideas to pick from, photo first: a tap puts one on the end of the list or takes it off. */
export function WishPicker({ open, onOpenChange, me, ideas, picked }: WishPickerProps) {
  const queryClient = useQueryClient();
  const readOnly = useReadOnly();
  const choices = ideas.filter((item) => !item.pending);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Pick your top ideas"
      description="Tap to add one to the end or take it off. Drag them into order on the list."
      wide
      tall
      footer={
        <Button variant="primary" fullWidth onClick={() => onOpenChange(false)}>
          Done
        </Button>
      }
    >
      {choices.length ? (
        <ul className="grid grid-cols-3 gap-x-3 gap-y-4 md:grid-cols-5 md:gap-x-4 md:gap-y-5" aria-label="Ideas">
          {choices.map((item) => {
            const cover = item.photos[0];
            const at = picked.indexOf(item.id);
            return (
              <li key={item.id} className="min-w-0">
                <PickTile
                  title={itemName(item).text}
                  photo={cover ? { src: photoSrc(cover.id, "thumb"), color: cover.color || undefined } : undefined}
                  note={item.note.trim() || undefined}
                  rank={at >= 0 ? at + 1 : null}
                  disabled={readOnly}
                  onToggle={() => toggleWishlist(queryClient, me, item, { quiet: true })}
                />
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-body text-ink-soft py-6">No ideas to pick from yet. Capture one, and it will be here.</p>
      )}
    </Sheet>
  );
}
