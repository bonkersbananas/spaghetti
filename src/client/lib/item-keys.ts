/**
 * The query keys of items, apart from lib/items.ts (and the outbox behind it) so the code that runs at start-up,
 * which only needs a key, doesn't pull them into the sign-in screen's first load.
 */
export type ItemList = "ideas" | "builds";

export const itemKeys = {
  all: ["items"] as const,
  list: (list: ItemList) => ["items", "list", list] as const,
  detail: (id: string) => ["items", "detail", id] as const,
};
