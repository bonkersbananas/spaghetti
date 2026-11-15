import { spoolName } from "@shared/spools";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { CheckIcon, ShoppingIcon } from "@/components/ui/icons";
import { toast } from "@/components/ui/Toast";
import { sessionQuery } from "@/lib/queries";
import { useReadOnly } from "@/lib/read-only";
import type { LowSpool } from "@/lib/running-low";
import { addSpoolsToShopping, sameWords, shoppingQuery } from "@/lib/shopping";

/**
 * "Add to shopping list" for the spools running low: one line for each that isn't to buy already. Loaded after the
 * Pantry's first screen (the list's writes aren't needed to read it).
 */
export function ToShoppingList({ low, demo }: { low: readonly LowSpool[]; demo?: boolean }) {
  const queryClient = useQueryClient();
  const readOnly = useReadOnly();
  const me = useQuery(sessionQuery).data?.id;
  const { data: listed, isPending } = useQuery(shoppingQuery);
  const toBuy = (listed ?? []).filter((thing) => thing.boughtAt === null);
  const lines = low.map(({ spool }) => {
    const name = spoolName(spool);
    return [name.title, name.detail].filter(Boolean).join(", ");
  });
  const missing = lines.filter((line) => !toBuy.some((thing) => sameWords(thing.name, line)));
  const allOnList = !isPending && missing.length === 0;
  const put = async () => {
    if (!me) return;
    const added = await addSpoolsToShopping(queryClient, missing, me);
    if (added)
      toast.success(
        added === 1 ? "On the shopping list" : `${added} spools on the shopping list`,
        "Tick them off there when they arrive.",
      );
  };
  return (
    <Button
      variant="secondary"
      size="sm"
      icon={allOnList ? CheckIcon : ShoppingIcon}
      disabled={isPending || demo || allOnList || readOnly}
      onClick={() => void put()}
    >
      {allOnList ? "On the shopping list" : "Add to shopping list"}
    </Button>
  );
}
