import { useEffect, useState } from "react";

/**
 * False until the browser is idle after the first paint, then true. For parts of a screen that are real but
 * not what the first paint is about (their code loads from an idle moment, so the first load stays lean).
 */
export function useIdle(): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    if (typeof requestIdleCallback !== "function") {
      const timer = setTimeout(() => setIdle(true), 200);
      return () => clearTimeout(timer);
    }
    const handle = requestIdleCallback(() => setIdle(true), { timeout: 1500 });
    return () => cancelIdleCallback(handle);
  }, []);
  return idle;
}
