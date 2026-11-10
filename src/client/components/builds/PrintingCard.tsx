import type { Person } from "@shared/api";
import type { Outcome } from "@shared/attempts";
import { printProgress } from "@shared/print-progress";
import { Link, useNavigate } from "@tanstack/react-router";
import { Avatar, ViaText } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { MetaList } from "@/components/ui/MetaList";
import { NoteFace } from "@/components/ui/NoteFace";
import { Photo } from "@/components/ui/Photo";
import { PrintProgress } from "@/components/ui/PrintProgress";
import { heroPhoto } from "@/lib/builds";
import type { AttemptView, ItemView } from "@/lib/items";
import { fileThumbSrc, photoSrc } from "@/lib/previews";
import { useNow } from "@/lib/use-now";
import { itemName } from "../journal/JournalEntry";
import { OutcomeChip, OutcomePicker } from "./Outcome";
import { SettingsLine } from "./SettingsLine";

interface PrintingCardProps {
  item: ItemView;
  /** The attempt that is on the bed (its outcome is null). */
  attempt: AttemptView;
  /** Who started it. */
  person?: Person;
  via?: string;
}

/**
 * A print on the bed, big and warm: the build's picture, its name in Fraunces (the one card title that is,
 * because this is the screen's focal point), how far along it is, and a way to finish it. The card leads to
 * the build; Finish goes to the build with the attempt's sheet open. When the print should be done, the button
 * gives way to the question people came to answer: how did it go?
 */
export function PrintingCard({ item, attempt, person, via }: PrintingCardProps) {
  const navigate = useNavigate();
  const now = useNow();
  const due = printProgress(attempt.printedAt, attempt.settings.estimatedMinutes, now).state === "due";
  const hero = heroPhoto(item);
  const plate = !hero && attempt.file?.hasThumb ? attempt.file : undefined;
  const name = itemName(item);
  const filaments = attempt.settings.filaments ?? [];

  const finish = (outcome?: Outcome) =>
    void navigate({
      to: "/builds/$buildId",
      params: { buildId: item.id },
      search: { attempt: attempt.id, finish: outcome ?? "1" },
    });

  return (
    <article className="bg-cream shadow-soft hover:shadow-raised hover:bg-lifted duration-fast relative flex flex-col rounded-lg p-1.5 transition-shadow md:flex-row">
      {/* The whole card leads to the build; what is inside that can be pressed sits above it. */}
      <Link
        to="/builds/$buildId"
        params={{ buildId: item.id }}
        search={{ attempt: attempt.id }}
        className="focus-ring absolute inset-0 z-0 rounded-lg"
      >
        <span className="sr-only">
          {name.text}, attempt {attempt.number}
        </span>
      </Link>
      <div className="pointer-events-none relative aspect-4/3 shrink-0 overflow-hidden rounded-md md:w-2/5">
        {hero ? (
          <Photo src={photoSrc(hero.id, "thumb")} alt="" color={hero.color || undefined} className="size-full" />
        ) : plate ? (
          <Photo src={fileThumbSrc(plate.id)} alt="" fit="contain" className="size-full p-3" />
        ) : (
          <NoteFace note={name.text} />
        )}
        <OutcomeChip outcome={null} className="shadow-soft absolute bottom-2 left-2" />
      </div>
      <div className="pointer-events-none relative flex min-w-0 flex-1 flex-col gap-2.5 px-2 pt-2.5 pb-2 md:px-4 md:py-3">
        <div className="flex items-start gap-3">
          <h3 className="font-display text-title text-ink line-clamp-2 min-w-0 flex-1 break-words">{name.text}</h3>
          {person && (
            <span className="mt-1.5 flex shrink-0 items-center gap-2">
              <ViaText name={via} className="hidden md:inline" />
              <Avatar person={person} size="xs" via={via} />
            </span>
          )}
        </div>
        <MetaList className="text-small text-ink-faint">
          <span className="whitespace-nowrap">attempt {attempt.number}</span>
          {filaments.length > 0 && (
            <SettingsLine
              filaments={filaments}
              parts={[]}
              name={(filament) => [filament.colorName, filament.type].filter(Boolean).join(" ") || "Filament"}
              className="inline-flex flex-wrap"
            />
          )}
        </MetaList>
        <PrintProgress startedAt={attempt.printedAt} estimatedMinutes={attempt.settings.estimatedMinutes} />
        {due ? (
          <div className="pointer-events-auto flex flex-col gap-2 md:mt-auto">
            <p className="text-small text-ink-soft font-semibold">How did it go?</p>
            <OutcomePicker value={null} onChange={(outcome) => finish(outcome)} size="md" />
          </div>
        ) : (
          <div className="pointer-events-auto flex justify-end md:mt-auto">
            <Button variant="secondary" size="sm" onClick={() => finish()}>
              Finish
            </Button>
          </div>
        )}
      </div>
    </article>
  );
}
