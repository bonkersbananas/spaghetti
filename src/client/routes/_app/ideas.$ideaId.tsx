import { fullTime, inlineTime } from "@shared/time";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AddFirstPhotos } from "@/components/ideas/AddFirstPhotos";
import { photoAlt } from "@/components/ideas/IdeaCard";
import { PhotoStrip } from "@/components/ideas/PhotoStrip";
import { PhotoViewer } from "@/components/ideas/PhotoViewer";
import { EmptyPot } from "@/components/illustrations";
import { DetailBar } from "@/components/shell/DetailBar";
import { ActionBar } from "@/components/ui/ActionBar";
import { Avatar, ViaText } from "@/components/ui/Avatar";
import { Button, IconButton } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { TextArea } from "@/components/ui/Field";
import { BuildsIcon, TrashIcon } from "@/components/ui/icons";
import { NoteField } from "@/components/ui/NoteField";
import { SaveStatus } from "@/components/ui/SaveStatus";
import { Skeleton } from "@/components/ui/Skeleton";
import { useVia } from "@/lib/agents";
import { startBuild } from "@/lib/builds";
import { useCaptureHere } from "@/lib/capture";
import { shortcutCaps, useHotkeys } from "@/lib/hotkeys";
import { deleteItem, type ItemView, useItem, useItemFields } from "@/lib/items";
import { useScreenActions } from "@/lib/palette";
import { peopleQuery } from "@/lib/queries";
import { canEdit, useReadOnly } from "@/lib/read-only";
import { itemName, useRememberItem } from "@/lib/recent";
import { useIsDesktop } from "@/lib/use-media-query";

export const Route = createFileRoute("/_app/ideas/$ideaId")({
  component: IdeaDetail,
});

function IdeaDetail() {
  const { ideaId } = Route.useParams();
  const { item, isPending, error } = useItem(ideaId);
  const navigate = useNavigate();
  const isBuild = !!item && item.stage !== "idea";
  // It grew into a build (here or on the other phone): that's where it lives now.
  useEffect(() => {
    if (isBuild) void navigate({ to: "/builds/$buildId", params: { buildId: ideaId }, replace: true });
  }, [isBuild, ideaId, navigate]);
  if (item && !isBuild) return <Idea key={item.id} item={item} />;
  return (
    <>
      <h1 className="sr-only">Idea</h1>
      <DetailBar back={back} />
      {isPending || isBuild ? (
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

const back = { to: "/ideas", label: "Ideas" } as const;

function Idea({ item }: { item: ItemView }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const readOnly = useReadOnly(item.pending);
  const { data: people } = useQuery(peopleQuery);
  useCaptureHere(item);
  const person = people?.find((p) => p.id === item.createdBy);
  const via = useVia()(item.createdVia);

  const { title, setTitle, note, setNote, saveState } = useItemFields(item);

  const photos = item.photos.filter((photo) => !photo.attemptId);
  const [selectedId, setSelectedId] = useState(photos[0]?.id);
  const selectedIndex = Math.max(
    0,
    photos.findIndex((photo) => photo.id === selectedId),
  );
  const select = (index: number) => {
    const photo = photos[Math.max(0, Math.min(photos.length - 1, index))];
    if (photo) setSelectedId(photo.id);
  };

  function remove() {
    if (!canEdit(item.pending)) return;
    deleteItem(queryClient, item);
    void navigate({ to: "/ideas" });
  }

  function build() {
    if (!canEdit(item.pending)) return;
    startBuild(queryClient, item);
    void navigate({ to: "/builds/$buildId", params: { buildId: item.id } });
  }

  useScreenActions("This idea", [
    {
      id: "build",
      label: "Start building",
      icon: BuildsIcon,
      shortcut: "ideaBuild",
      keywords: "build begin print move to builds",
      run: build,
    },
  ]);
  useRememberItem({
    id: item.id,
    kind: "idea",
    title: itemName(item, "idea"),
    photo: photos[0] ? { id: photos[0].id, color: photos[0].color } : null,
  });

  useHotkeys({
    ideaBack: () => void navigate({ to: "/ideas" }),
    ideaPhotoPrevious: () => select(selectedIndex - 1),
    ideaPhotoNext: () => select(selectedIndex + 1),
    ideaDelete: remove,
    ideaBuild: build,
  });

  const hasPhotos = photos.length > 0;
  const alt = photoAlt({ title, note });

  return (
    <article className="pb-6">
      <h1 className="sr-only">{title.trim() || "Untitled idea"}</h1>
      <DetailBar back={back}>
        <SaveStatus state={saveState} className="mr-2" />
        <IconButton
          icon={TrashIcon}
          label="Delete idea"
          onClick={remove}
          disabled={readOnly}
          aria-keyshortcuts="Backspace Delete"
        />
        {isDesktop && (
          <Button
            variant="primary"
            icon={BuildsIcon}
            shortcut={shortcutCaps("ideaBuild")}
            onClick={build}
            disabled={readOnly}
            className="ml-2"
          >
            Start building
          </Button>
        )}
      </DetailBar>

      <div className={hasPhotos ? "flex flex-col gap-6 md:flex-row md:items-start md:gap-10" : "max-w-content"}>
        {hasPhotos && (
          <div className="flex flex-col gap-4 md:sticky md:top-8 md:min-w-0 md:flex-3">
            <PhotoViewer
              photos={photos}
              index={selectedIndex}
              onIndexChange={select}
              alt={alt}
              className="-mx-5 md:mx-0"
            />
            <PhotoStrip
              itemId={item.id}
              photos={photos}
              selectedId={photos[selectedIndex]?.id}
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
            readOnly={readOnly}
            value={title}
            onChange={(event) => setTitle(event.target.value.replace(/\n/g, " "))}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === "Escape") {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
          />
          <NoteField
            value={note}
            onChange={setNote}
            readOnly={readOnly}
            placeholder="Add a note: a link, a measurement, a half-thought…"
          />

          <div className="text-small text-ink-faint mt-4 flex items-center gap-2.5">
            {person && <Avatar person={person} size="sm" via={via} />}
            <p>
              {person ? `${person.name.split(" ")[0]} captured this` : "Captured"}{" "}
              <time dateTime={new Date(item.createdAt).toISOString()} title={fullTime(item.createdAt)}>
                {inlineTime(item.createdAt)}
              </time>
              {via && (
                <>
                  {" "}
                  <ViaText name={via} />
                </>
              )}
            </p>
          </div>
        </div>
      </div>
      {!isDesktop && (
        <ActionBar>
          <Button variant="primary" size="lg" icon={BuildsIcon} fullWidth disabled={readOnly} onClick={build}>
            Start building
          </Button>
        </ActionBar>
      )}
    </article>
  );
}
