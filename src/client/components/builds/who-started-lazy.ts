/**
 * The way to "Who started it?" (PrinterBy): a module of its own, so the cards that show the printer's prints carry one
 * small import and not the picker's dependency list (Vite's preload list for a lazy import sits in the importer).
 */
export const loadWhoStarted = () => import("./WhoStarted");
