/**
 * A build's or idea's name, by the one rule every screen uses (shared/item-name.ts): its title, else its link's page
 * title, else the first line of its note, else "Untitled idea". Its own file, because the shell (the now-printing
 * strip) needs it on every screen and the journal's cards, which import a lot, do not.
 */
export { type ItemName, itemName, UNTITLED } from "@shared/item-name";
