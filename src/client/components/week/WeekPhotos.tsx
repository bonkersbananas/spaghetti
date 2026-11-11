import type { Person } from "@shared/api";
import type { WeekPrint } from "@shared/week";
import { OutcomeChip } from "@/components/builds/Outcome";
import { Card } from "@/components/ui/Card";
import { Section } from "@/components/ui/Section";
import { cn } from "@/lib/cn";
import { photoSrc } from "@/lib/previews";
import { useIsDesktop } from "@/lib/use-media-query";

/** How many of the week's pictures are shown; the rest are counted in the lines beside them. */
export const WEEK_PHOTOS_SHOWN = 9;

interface WeekPhotosProps {
  /** The week's finished prints, worked first (the server's order). */
  prints: WeekPrint[];
  people: Map<string, Person>;
}

/**
 * Photos first: the final picture of each print of the week, the best one large and the rest in a grid under it.
 * Each opens its attempt in its build. Prints with no picture aren't drawn here, only counted in the lines.
 */
export function WeekPhotos({ prints, people }: WeekPhotosProps) {
  const pictured = prints.filter((print) => print.photo);
  if (!pictured.length) return null;
  const shown = pictured.slice(0, WEEK_PHOTOS_SHOWN);
  const [lead, ...rest] = shown;
  const more = pictured.length - shown.length;
  const desktop = useIsDesktop();
  const orphan = rest.length % 2 === 1;
  return (
    <Section id="week-prints" title="The prints" size="overline">
      <div className="flex flex-col gap-3 md:gap-4">
        {lead?.photo && <PrintCard print={lead} lead people={people} />}
        {rest.length > 0 && (
          <ul className="m-0 grid list-none grid-cols-2 items-stretch gap-3 p-0 md:grid-cols-3 md:gap-4">
            {rest.map((print) => (
              <li
                key={print.attemptId}
                // An odd count would leave one card alone at half width on a phone: the last one spans both columns.
                className={cn("flex min-w-0 *:h-full", orphan && print === rest.at(-1) && "col-span-2 md:col-span-1")}
              >
                <PrintCard print={print} wide={orphan && print === rest.at(-1) && !desktop} people={people} />
              </li>
            ))}
          </ul>
        )}
        {more > 0 && <p className="text-small text-ink-faint">and {more} more with pictures</p>}
      </div>
    </Section>
  );
}

function PrintCard({
  print,
  lead = false,
  wide = false,
  people,
}: {
  print: WeekPrint;
  lead?: boolean;
  wide?: boolean;
  people: Map<string, Person>;
}) {
  if (!print.photo) return null;
  const title = print.title?.trim() || "Untitled";
  return (
    <Card
      headingLevel={3}
      aspect={lead || wide ? "landscape" : "portrait"}
      photo={{
        src: photoSrc(print.photo.id, lead || wide ? "large" : "thumb"),
        alt: title,
        color: print.photo.color,
        id: print.photo.id,
      }}
      title={title}
      chips={<OutcomeChip outcome={print.outcome} />}
      meta={`Attempt ${print.attempt}`}
      person={people.get(print.by)}
      link={{ to: "/builds/$buildId", params: { buildId: print.itemId }, search: { attempt: print.attemptId } }}
    />
  );
}
