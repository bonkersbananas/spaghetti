import { useSyncExternalStore } from "react";

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Matches the md breakpoint (48rem = 768 px): the desktop layout. */
export function useIsDesktop(): boolean {
  return useMediaQuery("(min-width: 48rem)");
}

/** Matches the lg breakpoint (64rem = 1024 px): room for columns side by side beside the sidebar. */
export function useIsWide(): boolean {
  return useMediaQuery("(min-width: 64rem)");
}
