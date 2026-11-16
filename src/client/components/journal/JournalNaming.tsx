import type { Item } from "@shared/api";
import { ClaudeLine } from "@/components/ui/ClaudeLine";
import { itemName } from "@/lib/item-name";
import { useNaming } from "@/lib/naming";

/**
 * A captured idea's name in its Journal row while Claude names it (decision 0071): "Naming…" with Claude's mark, and
 * after the timeout the name it has, as the row shows it otherwise. The title itself arrives through the change feed.
 */
export function JournalNaming({ item }: { item: Item }) {
  const naming = useNaming(item);
  if (naming) {
    return (
      <ClaudeLine working className="min-h-6">
        Naming…
      </ClaudeLine>
    );
  }
  return <span className="text-body text-ink-soft truncate font-medium">{itemName(item).text}</span>;
}
