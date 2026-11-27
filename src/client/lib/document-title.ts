import { useEffect } from "react";

const APP = "Spaghetti";

/**
 * The tab's title while a page shows one thing: "Gridfinity baseplate · Spaghetti", by the name it has everywhere
 * (shared/item-name.ts). Back to plain "Spaghetti" when the page goes.
 */
export function useDocumentTitle(name: string | undefined) {
  useEffect(() => {
    if (!name) return;
    document.title = `${name} · ${APP}`;
    return () => {
      document.title = APP;
    };
  }, [name]);
}
