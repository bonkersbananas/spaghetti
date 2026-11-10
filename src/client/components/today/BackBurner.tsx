import type { Person } from "@shared/api";
import { ageWords } from "@shared/time";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { itemName } from "@/components/journal/JournalEntry";
import { Button } from "@/components/ui/Button";
import { BuildsIcon } from "@/components/ui/icons";
import { NoteFace } from "@/components/ui/NoteFace";
import { Overline } from "@/components/ui/Overline";
import { Photo } from "@/components/ui/Photo";
import { startBuild } from "@/lib/builds";
import type { ItemView } from "@/lib/items";
import { photoSrc } from "@/lib/previews";
import { useReadOnly } from "@/lib/read-only";

/** Ideas this old are candidates for the back burner. */
const OLD_DAYS = 14;
const DAY = 24 * 60 * 60 * 1000;

/** YYYY-MM-DD in local time: the same for both people all day, and different tomorrow. */
export const localDay = (time: number) => {
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

/** A small, stable hash of a string (FNV-1a). */
function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value;
}

/**
 * One old idea comes back each day, so the inbox doesn't become a graveyard. The pick is the day's hash modulo
 * the candidates (oldest first, ties by id), so both people see the same idea all day, whatever order their
 * lists are in.
 */
export function backBurnerIdea(ideas: ItemView[], now = Date.now()): ItemView | undefined {
  const candidates = ideas
    .filter((idea) => idea.stage === "idea" && !idea.pending && now - idea.createdAt > OLD_DAYS * DAY)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  if (candidates.length === 0) return undefined;
  return candidates[hash(localDay(now)) % candidates.length];
}

/** An old idea, with a way to start building it. Nothing is drawn when no idea is old enough. */
export function BackBurner({ idea, person }: { idea: ItemView | undefined; person?: Person }) {
  const queryClient = useQueryClient();
  const readOnly = useReadOnly(idea?.pending);
  if (!idea) return null;
  const photo = idea.photos[0];
  const name = itemName(idea);
  return (
    <section aria-labelledby="today-burner" className="flex flex-col gap-3">
      <Overline as="h2" id="today-burner">
        On the back burner
      </Overline>
      <div className="hover:bg-ink/4 pressable relative -mx-1.5 flex gap-4 rounded-lg p-1.5">
        <Link to="/ideas/$ideaId" params={{ ideaId: idea.id }} className="focus-ring absolute inset-0 z-0 rounded-lg">
          <span className="sr-only">{name.text}</span>
        </Link>
        <div className="pointer-events-none relative aspect-4/5 w-28 shrink-0 overflow-hidden rounded-md">
          {photo ? (
            <Photo src={photoSrc(photo.id, "thumb")} alt="" color={photo.color || undefined} className="size-full" />
          ) : (
            <NoteFace note={idea.note || name.text} />
          )}
        </div>
        <div className="pointer-events-none relative flex min-w-0 flex-1 flex-col items-start gap-1 py-1">
          <p className="text-body text-ink line-clamp-2 font-semibold">{name.text}</p>
          <p className="text-small text-ink-faint">
            {person ? `${person.name.split(" ")[0]} · ` : ""}
            {ageWords(idea.createdAt)}
          </p>
          <Button
            variant="secondary"
            size="sm"
            icon={BuildsIcon}
            disabled={readOnly}
            onClick={() => startBuild(queryClient, idea)}
            className="pointer-events-auto mt-auto"
          >
            Start building
          </Button>
        </div>
      </div>
    </section>
  );
}
