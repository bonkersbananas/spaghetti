/** Which build this page runs: the name of its entry script (Vite hashes it, so every deploy has its own). */
export const appVersion = () =>
  document.querySelector<HTMLScriptElement>("script[type=module][src]")?.getAttribute("src")?.split("/").pop() ??
  "unknown";
