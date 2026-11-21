/**
 * The way into PrintPlace (decision 0076) for the cards and story entries that show a print. A module of its own with
 * nothing else in it: a lazy import carries the list of every file its target needs (63 for PrintPlace, about 1.1 kB
 * gzip), and it is this module's chunk, loaded only for a print the printer filed, that carries it, not the first
 * load of every screen with a print on the bed.
 */
export const loadPrintPlace = () => import("./PrintPlace");
