import { isOutcome } from "./outcomes.ts";

/**
 * What was kept on a device may have been written by an older version of the app, so its values can be ones this
 * version has no word for. Walks cached JSON and repairs what would crash a screen: an `outcome` that is not one of
 * the outcomes becomes null (an attempt with no verdict reads as printing or off the bed). Typed text is never touched.
 * Returns the same value when nothing needed repair.
 */
export function sanitizeCached<T>(value: T): T {
  if (Array.isArray(value)) {
    let copy: unknown[] | undefined;
    value.forEach((item, index) => {
      const clean = sanitizeCached(item);
      if (clean === item) return;
      copy ??= [...value];
      copy[index] = clean;
    });
    return (copy ?? value) as T;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    let copy: Record<string, unknown> | undefined;
    for (const [key, inner] of Object.entries(record)) {
      const clean = key === "outcome" && inner != null && !isOutcome(inner) ? null : sanitizeCached(inner);
      if (clean === inner) continue;
      copy ??= { ...record };
      copy[key] = clean;
    }
    return (copy ?? value) as T;
  }
  return value;
}
