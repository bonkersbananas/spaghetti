import type { Part, Photo as PhotoType } from "@shared/api";
import { cleanPartName, MAX_PART_NAME, MAX_PARTS } from "@shared/parts";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button, IconButton } from "@/components/ui/Button";
import { ImageIcon, PlusIcon, TrashIcon } from "@/components/ui/icons";
import { Photo } from "@/components/ui/Photo";
import { Stepper } from "@/components/ui/Stepper";
import { cn } from "@/lib/cn";
import { removePart, saveParts } from "@/lib/parts";
import { photoSrc } from "@/lib/previews";
import { useAutosave } from "@/lib/use-autosave";

const field =
  "bg-ink/4 shadow-well text-body md:text-small text-ink placeholder:text-ink-faint focus:shadow-ring h-11 min-w-0 flex-1 rounded-md px-3 font-semibold md:h-9";

function PartRow({ itemId, part, photos }: { itemId: string; part: Part; photos: PhotoType[] }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(part.name);
  const [quantity, setQuantity] = useState(part.quantity);
  const [picking, setPicking] = useState(false);
  // A blank name isn't saved: the part keeps its last name until one is typed.
  useAutosave({ name: cleanPartName(name), quantity }, async (value) => {
    if (!value.name) return;
    await saveParts(queryClient, itemId, [{ id: part.id, ...value }]);
  });
  const photo = photos.find((candidate) => candidate.id === part.photoId);
  return (
    <li className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        {photos.length > 0 && (
          <button
            type="button"
            aria-label={photo ? `Photo of ${part.name}` : `Pick a photo of ${part.name}`}
            aria-expanded={picking}
            onClick={() => setPicking((open) => !open)}
            className="bg-ink/4 shadow-well focus-ring text-ink-faint touch-target relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-md md:size-9"
          >
            {photo ? (
              <Photo src={photoSrc(photo.id, "thumb")} alt="" color={photo.color || undefined} className="size-full" />
            ) : (
              <ImageIcon size={18} aria-hidden />
            )}
          </button>
        )}
        <input
          aria-label={`Name of ${part.name}`}
          value={name}
          maxLength={MAX_PART_NAME}
          enterKeyHint="done"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
          className={field}
        />
        <Stepper label={`${part.name}, needed`} value={quantity} min={1} onChange={setQuantity} />
        <IconButton
          icon={TrashIcon}
          label={`Remove ${part.name}`}
          onClick={() => removePart(queryClient, itemId, part)}
        />
      </div>
      {picking && (
        <div className="-mx-5 flex gap-2 overflow-x-auto px-5 py-1 md:mx-0 md:px-0">
          {[null, ...photos].map((candidate) => (
            <button
              key={candidate?.id ?? "none"}
              type="button"
              aria-pressed={(candidate?.id ?? null) === (part.photoId ?? null)}
              aria-label={candidate ? "Use this photo" : "No photo"}
              onClick={() => {
                void saveParts(queryClient, itemId, [
                  { id: part.id, name: part.name, quantity: part.quantity, photoId: candidate?.id ?? null },
                ]);
                setPicking(false);
              }}
              className={cn(
                "bg-ink/4 shadow-well focus-ring text-small text-ink-faint relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md",
                (candidate?.id ?? null) === (part.photoId ?? null) && "shadow-ring",
              )}
            >
              {candidate ? (
                <Photo
                  src={photoSrc(candidate.id, "thumb")}
                  alt=""
                  color={candidate.color || undefined}
                  className="size-full"
                />
              ) : (
                "None"
              )}
            </button>
          ))}
        </div>
      )}
    </li>
  );
}

/**
 * Parts, edited where they are: a name, how many are needed, a photo, remove (with Undo). Every change autosaves.
 * Loaded when someone starts editing, so a build without parts costs nothing.
 */
export default function PartsEditor({
  itemId,
  parts,
  photos,
  onDone,
}: {
  itemId: string;
  parts: Part[];
  /** The build's own photos, for a part's picture. */
  photos: PhotoType[];
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const add = () => {
    const name = cleanPartName(draft);
    if (!name || parts.length >= MAX_PARTS) return;
    setDraft("");
    void saveParts(queryClient, itemId, [{ id: crypto.randomUUID(), name, quantity: 1 }]).catch(() => undefined);
  };
  return (
    <div className="flex flex-col gap-3">
      {parts.length > 0 && (
        <ul className="flex flex-col gap-3" aria-label="Parts">
          {parts.map((part) => (
            <PartRow key={part.id} itemId={itemId} part={part} photos={photos} />
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <input
          // biome-ignore lint/a11y/noAutofocus: it appears because someone tapped "Add parts".
          autoFocus
          aria-label="New part"
          placeholder={parts.length ? "Another part" : "A part, like Hull half"}
          value={draft}
          maxLength={MAX_PART_NAME}
          enterKeyHint="done"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
          className={field}
        />
        <Button variant="secondary" icon={PlusIcon} onClick={add} disabled={!cleanPartName(draft)}>
          Add
        </Button>
      </div>
      <div>
        <Button variant="quiet" size="sm" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}
