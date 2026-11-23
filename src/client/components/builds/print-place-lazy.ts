/**
 * The way into a printer's print's parts (decision 0076) for the cards and story entries that show one: PrintPlace (the
 * question, why it is here), PrinterBy (the tap that says who started it) and the printer's mark and line. A module of its own with nothing else in
 * it: a lazy import carries the list of every file its target needs (63 for PrintPlace, about 1.1 kB gzip), and it is
 * this module's chunk, loaded only for a print the printer recorded, that carries it, not the first load of every
 * screen with a print on the bed.
 */
export const loadPrintPlace = () => import("./PrintPlace");
export const loadPrinterBy = () => import("./PrinterBy");
export const loadJournalAsk = () => import("./PrintPlace").then((module) => ({ default: module.JournalAsk }));
export const loadPrinterMark = () => import("@/components/ui/PrinterMark");
