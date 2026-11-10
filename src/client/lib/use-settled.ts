import { useEffect, useState } from "react";

/**
 * A value that follows `value` once it has stopped changing for `ms`, for
 * things that cost something to react to while someone is still typing (a
 * request per half-typed address). It starts at the current value, so what is
 * already there shows at once.
 */
export function useSettled<T>(value: T, ms = 900): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}
