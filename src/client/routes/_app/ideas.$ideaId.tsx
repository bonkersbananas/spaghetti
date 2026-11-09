import { fullTime, relativeTime } from "@shared/time";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { photoAlt } from "@/components/ideas/IdeaCard";
import { PhotoStrip } from "@/components/ideas/PhotoStrip";
import { PhotoViewer } from "@/components/ideas/PhotoViewer";
import { EmptyPot } from "@/components/illustrations";
import { Avatar } from "@/components/ui/Avatar";
import { Button, IconButton } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { TextArea } from "@/components/ui/Field";
import { BackIcon, CameraIcon, ImageIcon, TrashIcon } from "@/components/ui/icons";
import { Kbd } from "@/components/ui/Kbd";
import { NoteField } from "@/components/ui/NoteField";
import { AddPhotoTile, useFilePicker } from "@/components/ui/PhotoTiles";
import { SaveStatus } from "@/components/ui/SaveStatus";
import { Skeleton } from "@/components/ui/Skeleton";
import { useHotkeys } from "@/lib/hotkeys";
import { addPhotosToItem, deleteItem, type ItemView, saveItemChanges, useItem } from "@/lib/items";
import { peopleQuery } from "@/lib/queries";
import { useAutosave } from "@/lib/use-autosave";
import { useIsDesktop } from "@/lib/use-media-query";

export const Route = createFileRoute("/_app/ideas/$ideaId")({
  component: IdeaDetail,
});

function IdeaDetail() {
  const { ideaId } = Route.useParams();
  const { item, isPending, error } = useItem(ideaId);
  if (item) return <Idea key={item.id} item={item} />;
  return (
    <>
      <h1 className="sr-only">Idea</h1>
      <DetailBar />
      {isPending ? (
        <div className="flex flex-col gap-6 md:flex-row md:gap-10" aria-hidden>
          <Skeleton className="-mx-5 aspect-4/3 rounded-none md:mx-0 md:flex-3 md:rounded-xl" />
          <div className="flex flex-col gap-3 md:flex-2">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </div>
      ) : (
        <EmptyState
          className="py-10 md:py-20"
          illustration={<EmptyPot />}
          title={error ? "This one is out of reach" : "This one boiled over"}
          action={
            <Link to="/ideas" className="focus-ring rounded-md">
              <Button variant="secondary" tabIndex={-1}>
                Back to ideas
              </Button>
            </Link>
          }
        >
          {error
            ? "It can't load without a connection. It will be here when you're back."
            : "This idea was deleted, or it never made it here."}
        </EmptyState>
      )}
    </>
  );
}

/** The top of a detail screen: a clear way back, and the screen's actions. */
function DetailBar({ children }: { children?: React.ReactNode }) {
  return (
    <div className="bg-paper/90 sticky top-0 z-20 -mx-5 mb-0 flex h-14 items-center justify-between gap-2 px-2 backdrop-blur-xl md:static md:mx-0 md:mb-6 md:h-auto md:bg-transparent md:px-0 md:pt-8 md:backdrop-blur-none">
      <Link
        to="/ideas"
        className="pressable focus-ring text-body text-ink-soft hover:text-ink flex h-11 items-center gap-1 rounded-md pr-3 pl-1.5 font-semibold md:h-9 md:pl-1"
      >
        <BackIcon size={22} weight="bold" aria-hidden />
        Ideas
        <Kbd keys={["Esc"]} className="ml-1.5" />
      </Link>
      <div className="flex items-center gap-1">{children}</div>
    </div>
  );
}

function Idea({ item }: { item: ItemView }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: people } = useQuery(peopleQuery);
  const person = people?.find((p) => p.id === item.createdBy);

  const [title, setTitle] = useState(item.title ?? "");
  const [note, setNote] = useState(item.note);
  const saveState = useAutosave({ title, note }, (value) =>
    saveItemChanges(queryClient, item.id, { title: value.title.trim() || null, note: value.note }),
  );

  const [selectedId, setSelectedId] = useState(item.photos[0]?.id);
  const selectedIndex = Math.max(
    0,
    item.photos.findIndex((photo) => photo.id === selectedId),
  );
  const select = (index: number) => {
    const photo = item.photos[Math.max(0, Math.min(item.photos.length - 1, index))];
    if (photo) setSelectedId(photo.id);
  };

  function remove() {
    deleteItem(queryClient, item);
    void navigate({ to: "/ideas" });
  }

  useHotkeys({
    escape: () => void navigate({ to: "/ideas" }),
    arrowleft: () => select(selectedIndex - 1),
    arrowright: () => select(selectedIndex + 1),
    backspace: remove,
    delete: remove,
  });

  const hasPhotos = item.photos.length > 0;
  const alt = photoAlt({ title, note });

  return (
    <article className="pb-6">
      <h1 className="sr-only">{title.trim() || "Untitled idea"}</h1>
      <DetailBar>
        <SaveStatus state={saveState} className="mr-2" />
        <IconButton icon={TrashIcon} label="Delete idea" onClick={remove} aria-keyshortcuts="Backspace Delete" />
      </DetailBar>

      <div className={hasPhotos ? "flex flex-col gap-6 md:flex-row md:items-start md:gap-10" : "max-w-content"}>
        {hasPhotos && (
          <div className="flex flex-col gap-4 md:sticky md:top-8 md:min-w-0 md:flex-3">
            <PhotoViewer
              photos={item.photos}
              index={selectedIndex}
              onIndexChange={select}
              alt={alt}
              className="-mx-5 md:mx-0"
            />
            <PhotoStrip
              itemId={item.id}
              photos={item.photos}
              selectedId={item.photos[selectedIndex]?.id}
              onSelect={setSelectedId}
            />
          </div>
        )}

        <div className="flex min-w-0 flex-col gap-3 md:flex-2 md:pt-2">
          {!hasPhotos && <AddFirstPhotos itemId={item.id} />}
          <TextArea
            appearance="title"
            aria-label="Title"
            placeholder="Untitled idea"
            minRows={1}
            maxLength={200}
            value={title}
            onChange={(event) => setTitle(event.target.value.replace(/\n/g, " "))}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === "Escape") {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
          />
          <NoteField value={note} onChange={setNote} placeholder="Add a note: a link, a measurement, a half-thought…" />

          <div className="text-small text-ink-faint mt-4 flex items-center gap-2.5">
            {person && <Avatar person={person} size="sm" />}
            <p>
              {person ? `${person.name.split(" ")[0]} captured this` : "Captured"}{" "}
              <time dateTime={new Date(item.createdAt).toISOString()} title={fullTime(item.createdAt)}>
                {relativeTime(item.createdAt).toLowerCase()}
              </time>
            </p>
          </div>
        </div>
      </div>
    </article>
  );
}

/** A note-only idea: one tap to give it its first photos. */
function AddFirstPhotos({ itemId }: { itemId: string }) {
  const isDesktop = useIsDesktop();
  const camera = useFilePicker({ camera: true, onFiles: (files) => addPhotosToItem(itemId, files) });
  const library = useFilePicker({ multiple: true, onFiles: (files) => addPhotosToItem(itemId, files) });
  return (
    <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-1">
      {camera.input}
      {library.input}
      {!isDesktop && <AddPhotoTile icon={CameraIcon} label="Take photo" onClick={camera.open} />}
      <AddPhotoTile
        icon={ImageIcon}
        label={isDesktop ? "Add photos" : "From library"}
        onClick={library.open}
        className="col-span-1"
      />
    </div>
  );
}
