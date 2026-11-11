import type { Person } from "@shared/api";
import { displayName } from "@shared/people";
import { ageWords } from "@shared/time";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { itemName } from "@/components/journal/JournalEntry";
import { Button, IconButton } from "@/components/ui/Button";
import { BuildsIcon, IdeasIcon } from "@/components/ui/icons";
import { Photo } from "@/components/ui/Photo";
import { Section } from "@/components/ui/Section";
import { startBuild } from "@/lib/builds";
import type { ItemView } from "@/lib/items";
import { photoSrc } from "@/lib/previews";
import { useReadOnly } from "@/lib/read-only";
import { useIsDesktop } from "@/lib/use-media-query";

/** An old idea, with a way to start building it. Nothing is drawn when no idea is old enough. */
export function BackBurner({ idea, person }: { idea: ItemView | undefined; person?: Person }) {
  const queryClient = useQueryClient();
  const readOnly = useReadOnly(idea?.pending);
  const isDesktop = useIsDesktop();
  if (!idea) return null;
  const photo = idea.photos[0];
  const name = itemName(idea);
  return (
    <Section id="today-burner" title="On the back burner" size="overline">
      <div className="hover:bg-ink/4 pressable relative -mx-1.5 flex items-center gap-3.5 rounded-lg p-1.5">
        <Link to="/ideas/$ideaId" params={{ ideaId: idea.id }} className="focus-ring absolute inset-0 z-0 rounded-lg">
          <span className="sr-only">{name.text}</span>
        </Link>
        <span className="pointer-events-none relative size-12 shrink-0 overflow-hidden rounded-md" aria-hidden>
          {photo ? (
            <Photo src={photoSrc(photo.id, "thumb")} alt="" color={photo.color || undefined} className="size-full" />
          ) : (
            <span className="bg-well text-ink-faint flex size-full items-center justify-center">
              <IdeasIcon size={22} />
            </span>
          )}
        </span>
        <div className="pointer-events-none relative flex min-w-0 flex-1 flex-col">
          <p className="text-body text-ink line-clamp-2 font-semibold">{name.text}</p>
          <p className="text-small text-ink-faint truncate">
            {person ? `${displayName(person)} · ` : ""}
            {ageWords(idea.createdAt)}
          </p>
        </div>
        {isDesktop ? (
          <Button
            variant="secondary"
            size="sm"
            icon={BuildsIcon}
            disabled={readOnly}
            onClick={() => startBuild(queryClient, idea)}
            className="pointer-events-auto relative shrink-0"
          >
            Start building
          </Button>
        ) : (
          // On a phone the name and the line under it get the width: the button is just its icon.
          <IconButton
            icon={BuildsIcon}
            label="Start building"
            disabled={readOnly}
            onClick={() => startBuild(queryClient, idea)}
            className="pointer-events-auto relative shrink-0"
          />
        )}
      </div>
    </Section>
  );
}
