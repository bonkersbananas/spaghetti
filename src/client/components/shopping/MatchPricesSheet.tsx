import type { ShoppingItem } from "@shared/api";
import { formatKr } from "@shared/prisjakt";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ClaudeLine } from "@/components/ui/ClaudeLine";
import { Sheet } from "@/components/ui/Sheet";
import { MatchRow } from "@/components/ui/Suggestion";
import { toast } from "@/components/ui/Toast";
import { useReadOnly } from "@/lib/read-only";
import { dismissSuggestion, shoppingQuery, updateShopping } from "@/lib/shopping";
import { useShoppingName } from "./ShoppingRow";

/**
 * "Match prices": every page Claude found for what's still to buy, in one sheet, each used only once someone taps Use
 * it. An answered one stays in its place and says what was done, so the next one never slides under the thumb; one
 * found while it is open joins at the end.
 */
export function MatchPricesSheet({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const [shown, setShown] = useState(ids);
  // A page found while it's open joins at the end; an answered one stays where it is.
  const key = ids.join();
  // biome-ignore lint/correctness/useExhaustiveDependencies: key stands for ids.
  useEffect(() => {
    setShown((current) => {
      const added = ids.filter((id) => !current.includes(id));
      return added.length ? [...current, ...added] : current;
    });
  }, [key]);
  const [answers, setAnswers] = useState<Record<string, "used" | "dismissed">>({});
  const { data } = useQuery(shoppingQuery);
  const byId = new Map(data?.map((item) => [item.id, item]));
  // A thing deleted meanwhile (by the other person) is gone from the sheet, and from what is left to check.
  const left = shown.filter((id) => byId.has(id) && !answers[id]).length;
  return (
    <Sheet
      open
      onOpenChange={(open) => !open && onClose()}
      title="Match prices"
      description={<ClaudeLine>Claude found these on Prisjakt. Check a page, then use it or not.</ClaudeLine>}
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <p className="text-small text-ink-faint" aria-live="polite">
            {left ? `${left} to check` : "All checked. Prices show on the list as they're read."}
          </p>
          <Button variant={left ? "quiet" : "secondary"} onClick={onClose}>
            Done
          </Button>
        </div>
      }
    >
      <ul aria-label="Pages to check" className="divide-hairline flex flex-col divide-y">
        {shown.map((id) => {
          const item = byId.get(id);
          if (!item) return null;
          return (
            <li key={id}>
              <Match
                item={item}
                answer={answers[id]}
                onAnswer={(answer) => setAnswers((current) => ({ ...current, [id]: answer }))}
              />
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}

function Match({
  item,
  answer,
  onAnswer,
}: {
  item: ShoppingItem;
  answer?: "used" | "dismissed";
  onAnswer: (answer: "used" | "dismissed") => void;
}) {
  const queryClient = useQueryClient();
  const readOnly = useReadOnly();
  const name = useShoppingName(item);
  // The page as it was offered: once used, the item has no suggestion any more, but the row still says which it was.
  const [suggestion] = useState(item.suggestion);
  if (!suggestion) return null;
  return (
    <MatchRow
      name={name}
      title={suggestion.title}
      href={suggestion.url}
      answer={answer}
      price={answer === "used" && item.prices ? formatKr(item.prices.lowest) : undefined}
      disabled={readOnly}
      onUse={() => {
        onAnswer("used");
        void updateShopping(queryClient, item.id, { priceLink: suggestion.url }).catch(() =>
          toast.error("Couldn't use that page", "Try again in a moment."),
        );
      }}
      onDismiss={() => {
        onAnswer("dismissed");
        void dismissSuggestion(queryClient, item.id).catch(() =>
          toast.error("Couldn't do that", "Try again in a moment."),
        );
      }}
    />
  );
}
