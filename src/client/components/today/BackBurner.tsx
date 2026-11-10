import type { Person } from "@shared/api";
import { displayName } from "@shared/people";
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
        <div className="shadow-soft pointer-events-none relative aspect-4/5 w-28 shrink-0 overflow-hidden rounded-md">
          {photo ? (
            <Photo src={photoSrc(photo.id, "thumb")} alt="" color={photo.color || undefined} className="size-full" />
          ) : (
            <NoteFace note={idea.note || name.text} />
          )}
        </div>
        <div className="pointer-events-none relative flex min-w-0 flex-1 flex-col items-start gap-1 py-1">
          {/* A note-only idea's words are already on its tile: say them once. */}
          {(photo || name.titled) && <p className="text-body text-ink line-clamp-2 font-semibold">{name.text}</p>}
          <p className="text-small text-ink-faint">
            {person ? `${displayName(person)} · ` : ""}
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
