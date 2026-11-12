import { modelOf } from "@shared/model-mark";
import { displayName } from "@shared/people";
import { fullTime, inlineTime } from "@shared/time";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { CommentThread, ItemReactions } from "@/components/comments/CommentThread";
import { AddFirstPhotos } from "@/components/ideas/AddFirstPhotos";
import { DraftNote } from "@/components/ideas/DraftNote";
import { photoAlt } from "@/components/ideas/IdeaCard";
import { PhotoStrip } from "@/components/ideas/PhotoStrip";
import { PhotoViewer } from "@/components/ideas/PhotoViewer";
import { EmptyPot } from "@/components/illustrations/EmptyPot";
import { DetailBar } from "@/components/shell/DetailBar";
import { ActionBar } from "@/components/ui/ActionBar";
import { Avatar, ViaText } from "@/components/ui/Avatar";
import { Button, IconButton } from "@/components/ui/Button";
import { ToggleChip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { TextArea } from "@/components/ui/Field";
import { ForChip, ForField } from "@/components/ui/ForField";
import { BuildsIcon, CommentIcon, MoveIntoIcon, TrashIcon, UpNextIcon, WishIcon } from "@/components/ui/icons";
import { ModelCard } from "@/components/ui/ModelMark";
import { NoteField } from "@/components/ui/NoteField";
import { NoteLinks } from "@/components/ui/NoteLinks";
import { PullToGo } from "@/components/ui/PullToGo";
import { SaveStatus } from "@/components/ui/SaveStatus";
import { Skeleton } from "@/components/ui/Skeleton";
import { toast } from "@/components/ui/Toast";
import { useVia } from "@/lib/agents";
import { startBuild } from "@/lib/builds";
import { useCaptureHere } from "@/lib/capture";
import { announceDraft } from "@/lib/drafts";
import { shortcutCaps, useHotkeys } from "@/lib/hotkeys";
import { deleteItem, type ItemView, removePhoto, useItem, useItemFields } from "@/lib/items";
import { whyNotMove } from "@/lib/move";
import { useScreenActions } from "@/lib/palette";
import { photoSrc } from "@/lib/previews";
import { peopleQuery, sessionQuery } from "@/lib/queries";
import { canEdit, useReadOnly } from "@/lib/read-only";
import { itemName, useRememberItem } from "@/lib/recent";
import { useStickyColumn } from "@/lib/sticky-column";
import { setUpNext } from "@/lib/up-next";
import { useIsDesktop } from "@/lib/use-media-query";
import { useSettled } from "@/lib/use-settled";
import { toggleWishlist, useWishlistIds } from "@/lib/wishlist";

const MoveToBuildSheet = lazy(() =>
  import("@/components/ideas/MoveToBuildSheet").then((m) => ({ default: m.MoveToBuildSheet })),
);

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
        <div className="flex flex-col gap-6 md:flex-row md:gap-10 lg:gap-14" aria-hidden>
          <Skeleton className="-mx-5 aspect-4/3 w-[calc(100%+2.5rem)] rounded-none md:mx-0 md:w-auto md:flex-2 md:rounded-xl" />
          <div className="flex flex-col gap-3 md:flex-3">
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
  const stickyColumn = useStickyColumn();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const readOnly = useReadOnly(item.pending);
  // Saved photos can't be removed without a connection; one still uploading can.
  const offline = useReadOnly();
  const { data: people } = useQuery(peopleQuery);
  const { data: user } = useQuery(sessionQuery);
  const wished = useWishlistIds(user?.id).includes(item.id);
  useCaptureHere(item);
  const person = people?.find((p) => p.id === item.createdBy);
  const via = useVia()(item.createdVia);

  const { title, setTitle, note, setNote, forWhom, setForWhom, saveState } = useItemFields(item);
  const [askFor, setAskFor] = useState(false);

  // A draft that lands while this idea is open says so once, with a way to take it back (here or from the other phone).
  const draftStatus = useRef(item.draft?.status);
  useEffect(() => {
    if (draftStatus.current === "reading" && item.draft?.status === "drafted") announceDraft(queryClient, item);
    draftStatus.current = item.draft?.status;
  }, [item, queryClient]);

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

  const [moving, setMoving] = useState(false);
  const [moveAsked, setMoveAsked] = useState(false);
  function move() {
    if (!canEdit(item.pending)) return;
    const why = whyNotMove(queryClient, item);
    if (why) return toast.message("It stays where it is", why);
    setMoveAsked(true);
    setMoving(true);
  }

  // Counts up each time something asks to write a comment: the M key, the palette.
  const [writeAsk, setWriteAsk] = useState(0);
  const comment = () => {
    if (canEdit(item.pending)) setWriteAsk((n) => n + 1);
  };

  useScreenActions("This idea", [
    {
      id: "build",
      label: "Start building",
      icon: BuildsIcon,
      shortcut: "ideaBuild",
      keywords: "build begin print move to builds",
      run: build,
    },
    {
      id: "move",
      label: "Add to a build…",
      icon: MoveIntoIcon,
      shortcut: "ideaMove",
      keywords: "move tidy photos note attempt build into",
      run: move,
    },
    {
      id: "comment",
      label: "Say something about this idea",
      icon: CommentIcon,
      shortcut: "ideaComment",
      keywords: "comment message talk write reply chat",
      run: comment,
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
    ideaMove: move,
    ideaComment: item.pending ? undefined : comment,
  });

  const hasPhotos = photos.length > 0;
  const reading = item.draft?.status === "reading";
  // The model card follows the note once typing pauses (half an address is not a model page yet).
  const settledNote = useSettled(note);
  const model = modelOf({ note: settledNote, draft: item.draft });
  const modelPhoto = item.draft?.applied.includes("photos") ? photos.find((photo) => !photo.attemptId) : undefined;
  const modelPicture = modelPhoto ? { src: photoSrc(modelPhoto.id, "thumb"), color: modelPhoto.color } : undefined;
  const alt = photoAlt({ title, note });

  return (
    <PullToGo back={back}>
      <article className="pb-6">
        <h1 className="sr-only">{title.trim() || "Untitled idea"}</h1>
        <DetailBar back={back}>
          <SaveStatus state={saveState} className="mr-2" />
          <IconButton
            icon={TrashIcon}
            label="Delete idea"
            title={`Delete idea (${shortcutCaps("ideaDelete").join("")})`}
            onClick={remove}
            disabled={readOnly}
            aria-keyshortcuts="Backspace Delete"
          />
          {isDesktop && (
            <Button
              icon={MoveIntoIcon}
              shortcut={shortcutCaps("ideaMove")}
              onClick={move}
              disabled={readOnly}
              className="ml-2"
            >
              Add to a build
            </Button>
          )}
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

        {/* The build page's proportions (photo two parts, text three), so an idea that becomes a build keeps its photo
          where it was at the size it was, and the attempts take the side the text had. */}
        <div
          className={hasPhotos ? "flex flex-col gap-6 md:flex-row md:items-start md:gap-10 lg:gap-14" : "max-w-content"}
        >
          {hasPhotos && (
            <div ref={stickyColumn} className="sticky-column flex flex-col gap-4 md:min-w-0 md:flex-2">
              <PhotoViewer
                photos={photos}
                index={selectedIndex}
                onIndexChange={select}
                alt={alt}
                onRemove={
                  offline && !photos[selectedIndex]?.upload ? undefined : (photo) => removePhoto(queryClient, photo)
                }
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

          <div className="max-w-content flex min-w-0 flex-col gap-3 md:flex-3 md:pt-2">
            {/* While Claude reads the page, the empty photo area and title hold their place with the quiet shimmer. */}
            {!hasPhotos &&
              (reading ? <Skeleton className="mb-4 h-28 rounded-xl" /> : <AddFirstPhotos itemId={item.id} />)}
            {reading && !title.trim() ? (
              <Skeleton className="my-1.5 h-8 w-3/4" />
            ) : (
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
            )}
            <ForField
              aria-label="For"
              value={forWhom}
              onChange={(event) => setForWhom(event.target.value)}
              readOnly={readOnly || item.pending}
              asking={askFor}
              onOpen={() => setAskFor(true)}
              onDone={() => setAskFor(false)}
            />
            <div className="flex flex-wrap gap-2">
              <ToggleChip
                selected={item.upNext !== null}
                icon={UpNextIcon}
                disabled={readOnly || item.pending}
                onClick={() => setUpNext(queryClient, item, item.upNext === null)}
              >
                Up next
              </ToggleChip>
              <ToggleChip
                selected={wished}
                icon={WishIcon}
                disabled={readOnly || item.pending || !user}
                onClick={() => user && toggleWishlist(queryClient, user.id, item)}
              >
                My wishlist
              </ToggleChip>
              {!forWhom.trim() && !askFor && !(readOnly || item.pending) && <ForChip onClick={() => setAskFor(true)} />}
            </div>
            {model && <ModelCard mark={model} picture={modelPicture} className="my-1" />}
            <NoteField
              value={note}
              onChange={setNote}
              readOnly={readOnly}
              placeholder="Add a note: a link, a measurement, a half-thought…"
            />
            <DraftNote item={item} title={title} note={note} readOnly={readOnly} />
            <NoteLinks note={note} skip={model?.url} />

            <div className="text-small text-ink-faint mt-4 flex items-center gap-2.5">
              {person && <Avatar person={person} size="sm" via={via} />}
              <p>
                {person ? `${displayName(person)} captured this` : "Captured"}{" "}
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
            {!item.pending && (
              <ItemReactions
                itemId={item.id}
                reactions={item.reactions}
                noun="idea"
                readOnly={readOnly}
                className="mt-1"
              />
            )}
            {/* The conversation follows the words it is about, in the same column (as on a build). */}
            {!item.pending && (
              <CommentThread itemId={item.id} writeAsk={writeAsk} readOnly={readOnly} className="mt-9 md:mt-13" />
            )}
          </div>
        </div>
        {moveAsked && (
          <Suspense fallback={null}>
            <MoveToBuildSheet
              open={moving}
              onOpenChange={setMoving}
              idea={item}
              onMoved={() => void navigate({ to: "/ideas" })}
            />
          </Suspense>
        )}
        {!isDesktop && (
          <ActionBar>
            <Button size="lg" icon={MoveIntoIcon} className="min-w-0 flex-1" disabled={readOnly} onClick={move}>
              Add to a build
            </Button>
            <Button
              variant="primary"
              size="lg"
              icon={BuildsIcon}
              className="min-w-0 flex-1"
              disabled={readOnly}
              onClick={build}
            >
              Start building
            </Button>
          </ActionBar>
        )}
      </article>
    </PullToGo>
  );
}
