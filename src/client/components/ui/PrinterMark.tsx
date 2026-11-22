import type { Person } from "@shared/api";
import { cn } from "@/lib/cn";
import { Avatar } from "./Avatar";

/** The avatar sizes it stands in for (ui/Avatar.tsx). */
const sizes = { xs: "size-6", sm: "size-7", md: "size-9", lg: "size-12" } as const;

/**
 * The printer, where a person would be named for what it did (decision 0076): a print the printer bridge recorded is
 * the printer's, never whoever paired the bridge. A rounded square, as an agent is (a circle is a person here), on a
 * layer of ink (as a row's glyph tile) with the printer glyph (`printer-mark` in tokens.css: no script but this), the
 * size of the avatar it stands in for. Once someone says who started the print, that person's avatar takes its place,
 * with the printer as its small mark (`Avatar printer`). Not part of the avatar's module, which every screen loads: the cards that show a
 * print from the printer load this with their other printer parts (`builds/print-place-lazy.ts`).
 */
export function PrinterMark({
  size = "md",
  decorative = false,
  className,
}: {
  size?: keyof typeof sizes;
  /** Beside the words "From the printer" already: hidden from screen readers. */
  decorative?: boolean;
  className?: string;
}) {
  return (
    <span
      {...(decorative ? { "aria-hidden": true } : { role: "img", "aria-label": "The printer", title: "The printer" })}
      className={cn("printer-mark", sizes[size], className)}
    />
  );
}

/**
 * Whose a print the printer recorded is, where an avatar would say who did it: "From the printer" and the printer's
 * mark, or "Sam · from the printer" and Sam's avatar with the printer as its small mark once someone said he started
 * it. `words` says where the words show: from tablet width up ("md", in a row where a phone has room for the mark
 * alone), always, or never. Only says it: on an attempt and a card on the bed `PrinterBy` (builds/) makes it the tap
 * that says who started it.
 */
export function PrinterByline({
  person,
  words = "md",
  className,
}: {
  person?: Pick<Person, "name" | "color"> & { photoUrl?: string | null };
  words?: "md" | "always" | "never";
  className?: string;
}) {
  return (
    <span className={cn("flex shrink-0 items-center gap-2", className)}>
      {words !== "never" && (
        <span
          className={cn(
            "text-ink-faint duration-fast group-hover/by:text-ink-soft whitespace-nowrap transition-colors",
            words === "md" && "hidden md:inline",
          )}
        >
          {person ? `${person.name} · from the printer` : "From the printer"}
        </span>
      )}
      {person ? (
        <Avatar person={person} size="xs" printer decorative={words === "always"} />
      ) : (
        <PrinterMark size="xs" decorative={words === "always"} />
      )}
    </span>
  );
}
