import { itemName, leadingLink } from "@shared/item-name";
import { linkName } from "@shared/link-name";
import { modelOf, sameModel } from "@shared/model-mark";
import { fullTime, inlineTime } from "@shared/time";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { lazy, memo, Suspense, useEffect, useRef, useState } from "react";
import { OpenOnlyFile } from "@/components/builds/OpenInStudio";
import { CommentThread, ItemReactions } from "@/components/comments/CommentThread";
import { AddFirstPhotos } from "@/components/ideas/AddFirstPhotos";
import { DraftNote } from "@/components/ideas/DraftNote";
import { photoAlt, plateAlt, plateCover } from "@/components/ideas/IdeaCard";
import { IdeaTitleChips } from "@/components/ideas/IdeaTitleChips";
import { PhotoStrip } from "@/components/ideas/PhotoStrip";
import { PhotoViewer } from "@/components/ideas/PhotoViewer";
import { PlateCover } from "@/components/ideas/PlateCover";
import { EmptyPot } from "@/components/illustrations/EmptyPot";
import { DetailBar } from "@/components/shell/DetailBar";
import { ActionBar } from "@/components/ui/ActionBar";
import { Avatar, ViaText } from "@/components/ui/Avatar";
import { Button, IconButton } from "@/components/ui/Button";
import { ClaudeLine } from "@/components/ui/ClaudeLine";
import { ConfirmDelete } from "@/components/ui/ConfirmDelete";
import { EmptyState } from "@/components/ui/EmptyState";
import { TextArea } from "@/components/ui/Field";
import { BuildsIcon, CommentIcon, MoveIntoIcon, SlicerFileIcon, TrashIcon, TwistIcon } from "@/components/ui/icons";
import { LinkCard } from "@/components/ui/LinkCard";
import { NameSourceLine } from "@/components/ui/NameSourceLine";
import { useNaming } from "@/components/ui/NamingSign";
import { NoteField } from "@/components/ui/NoteField";
import { NoteLinks } from "@/components/ui/NoteLinks";
import { PullToGo } from "@/components/ui/PullToGo";
import { SaveStatus } from "@/components/ui/SaveStatus";
import { ShareLinkButton } from "@/components/ui/ShareLinkButton";
import { Skeleton } from "@/components/ui/Skeleton";
import { toast } from "@/components/ui/Toast";
import { useVia } from "@/lib/agents";
import { startBuild } from "@/lib/builds";
import { useCaptureHere } from "@/lib/capture";
import { cn } from "@/lib/cn";
import { useDocumentTitle } from "@/lib/document-title";
import { announceDraft } from "@/lib/drafts";
import { ariaShortcuts, shortcutCaps, useHotkeys } from "@/lib/hotkeys";
import { deleteItem, type ItemView, useIdeas, useItem, useItemFields } from "@/lib/items";
import { whyNotMove } from "@/lib/move";
import { useBackTo } from "@/lib/origin";
import { useScreenActions } from "@/lib/palette";
import { spoolsQuery } from "@/lib/pantry-queries";
import { photoSrc } from "@/lib/previews";
import { keepOrigin } from "@/lib/previous-path";
import { linkPreviewQuery, peopleQuery, sessionQuery } from "@/lib/queries";
import { canEdit, useKeepEditing, useReadOnly } from "@/lib/read-only";
import { itemName as listName, useRememberItem } from "@/lib/recent";
import { recipesQuery } from "@/lib/recipes-query";
import { useSlicerDropTarget } from "@/lib/slicer-drop";
import { useStickyColumn } from "@/lib/sticky-column";
import { makeTwist, suggestedTwistName, useTwists } from "@/lib/twists";
import { setUpNext, splitQueue } from "@/lib/up-next";
import { useItemFilePicker } from "@/lib/use-item-file-picker";
import { useAfterPaint, useIsDesktop } from "@/lib/use-media-query";
import { useSettled } from "@/lib/use-settled";
import { useWho } from "@/lib/who";

const ItemFiles = lazy(() => import("@/components/ideas/ItemFiles"));
const MoveToBuildSheet = lazy(() =>
  import("@/components/ideas/MoveToBuildSheet").then((m) => ({ default: m.MoveToBuildSheet })),
);

export const Route = createFileRoute("/_app/ideas/$ideaId")({
  // The photo to open on: the one a card in the list was swiped to.
  validateSearch: (search: Record<string, unknown>): { photo?: string } =>
    typeof search.photo === "string" ? { photo: search.photo } : {},
  component: IdeaDetail,
});

/** Ideas whose Start building was just tapped: the tap moves to the build once its toast has painted. */
const startedHere = new Set<string>();

function IdeaDetail() {
  const { ideaId } = Route.useParams();
  const { item, isPending, error } = useItem(ideaId);
  const navigate = useNavigate();
  const isBuild = !!item && item.stage !== "idea";
  // The idea that was on screen until the moment it became a build: it stays there (untouched) while the build's page
  // gets ready, instead of giving way to a skeleton for a frame.
  const shown = useRef<ItemView | undefined>(undefined);
  if (item && !isBuild) shown.current = item;
  // It grew into a build (here or on the other phone): that's where it lives now.
  useEffect(() => {
    // Not for the build this person just started here: its tap takes the page over to the build itself.
    if (isBuild && !startedHere.has(ideaId))
      void navigate({ to: "/builds/$buildId", params: { buildId: ideaId }, replace: true });
  }, [isBuild, ideaId, navigate]);
  if (item && !isBuild) return <Idea key={item.id} item={item} />;
  if (isBuild && shown.current?.id === ideaId) return <Idea key={ideaId} item={shown.current} />;
  return (
    <>
      <h1 className="sr-only">Idea</h1>
      <DetailBar back={back} />
      {isPending || isBuild ? (
        <div className="flex flex-col gap-6 md:flex-row md:gap-10 lg:gap-14" aria-hidden>
          <Skeleton className="-mx-5 aspect-4/3 w-[calc(100%+2.5rem)] rounded-none md:mx-0 md:w-auto md:flex-2 md:rounded-xl lg:flex-4" />
          <div className="flex flex-col gap-3 md:flex-3 lg:flex-5">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </div>
      ) : (
        <EmptyState
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

const Idea = memo(function Idea({ item }: { item: ItemView }) {
  const stickyColumn = useStickyColumn();
  const after = useAfterPaint();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const readOnly = useReadOnly(item.pending);
  const { data: people } = useQuery(peopleQuery);
  const { data: user } = useQuery(sessionQuery);
  const who = useWho();
  useCaptureHere(item);
  // What the build's page asks for as it opens (its spools and recipes) is fetched while this idea is read, so
  // Start building doesn't begin two requests in the middle of its first paint.
  useEffect(() => {
    void queryClient.prefetchQuery(spoolsQuery);
    void queryClient.prefetchQuery(recipesQuery);
  }, [queryClient]);
  const person = people?.find((p) => p.id === item.createdBy);
  const via = useVia()(item.createdVia);

  const { title, setTitle, note, setNote, forWhom, setForWhom, saveState } = useItemFields(item);
  const titleKeep = useKeepEditing(readOnly);

  // A draft that lands while this idea is open says so once, with a way to take it back (here or from the other phone).
  const draftStatus = useRef(item.draft?.status);
  useEffect(() => {
    if (draftStatus.current === "reading" && item.draft?.status === "drafted") announceDraft(queryClient, item);
    draftStatus.current = item.draft?.status;
  }, [item, queryClient]);

  const photos = item.photos.filter((photo) => !photo.attemptId);
  // Opens on the photo its card in the list was swiped to, else the first.
  const opensOn = Route.useSearch().photo;
  const [selectedId, setSelectedId] = useState(photos.some((photo) => photo.id === opensOn) ? opensOn : photos[0]?.id);
  const selectedIndex = Math.max(
    0,
    photos.findIndex((photo) => photo.id === selectedId),
  );
  const select = (index: number) => {
    const photo = photos[Math.max(0, Math.min(photos.length - 1, index))];
    if (photo) setSelectedId(photo.id);
  };

  // Delete asks first, in place (ConfirmDelete); the key asks, and asks again to confirm.
  const [deleting, setDeleting] = useState(false);
  function remove() {
    if (!canEdit(item.pending)) return;
    deleteItem(queryClient, item);
    void navigate({ to: "/ideas" });
  }

  function build() {
    if (!canEdit(item.pending) || startedHere.has(item.id)) return;
    // The page swap is most of the work (the build's whole page mounts): it starts once the toast has painted.
    startedHere.add(item.id);
    startBuild(queryClient, item);
    setTimeout(() => {
      startedHere.delete(item.id);
      void navigate({ to: "/builds/$buildId", params: { buildId: item.id } });
    });
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

  // A twist is made from the idea with one tap: the idea's model, title and cover come along, and its page opens at once.
  const { twists } = useTwists();
  const existingTwist = twists?.find((twist) => twist.fromItemId === item.id);
  function twist() {
    // The idea's own kept file is not a link out: a twist takes only a model that lives on a site.
    const twistModelUrl = model && !model.url.startsWith("/api/files/") ? model.url : null;
    // Until the list has loaded we can't know whether this idea already has one.
    if (!canEdit(item.pending) || !user || !twists) return;
    if (existingTwist) return void navigate({ to: "/twists/$twistId", params: { twistId: existingTwist.id } });
    const id = makeTwist(
      queryClient,
      {
        name: suggestedTwistName({ title }, twistModelUrl),
        from: { id: item.id, photo: photos[0] ?? null, modelUrl: twistModelUrl, title },
      },
      user.id,
    );
    void navigate({ to: "/twists/$twistId", params: { twistId: id } });
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
      id: "twist",
      label: existingTwist ? "Open this idea's twist" : "Make a twist",
      icon: TwistIcon,
      keywords: "twist adapt change scale model remix",
      run: twist,
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
    title: listName(item, "idea"),
    photo: photos[0] ? { id: photos[0].id, color: photos[0].color } : null,
  });

  // Escape goes where the back control goes: to the page this idea was opened from, else to Ideas.
  const backTo = useBackTo(back);
  // J and K walk the inbox in the order its page shows it (Up next first), so a Monday's triage never goes back to the grid.
  const { items: inbox } = useIdeas();
  const { queue, rest } = splitQueue(inbox);
  const order = [...queue, ...rest];
  const place = order.findIndex((idea) => idea.id === item.id);
  const neighbour = (by: number) => {
    const next = place < 0 ? undefined : order[place + by];
    return next && !next.pending
      ? () => void navigate({ to: "/ideas/$ideaId", params: { ideaId: next.id }, state: keepOrigin })
      : undefined;
  };
  useHotkeys({
    // Asked when the key is pressed, not when the page draws: drawing offline toasted "Waiting for the connection".
    ideaUpNext: item.pending ? undefined : () => canEdit() && setUpNext(queryClient, item, item.upNext === null),
    ideaNext: neighbour(1),
    ideaPrevious: neighbour(-1),
    ideaBack: backTo.go,
    ideaPhotoPrevious: () => select(selectedIndex - 1),
    ideaPhotoNext: () => select(selectedIndex + 1),
    ideaDelete: () => (deleting ? remove() : canEdit(item.pending) && setDeleting(true)),
    ideaBuild: build,
    ideaMove: move,
    ideaComment: item.pending ? undefined : comment,
  });

  // A .gcode.3mf, .3mf or .stl is kept with the idea: picked here, or dropped anywhere on the page (desktop).
  const files = item.files ?? [];
  const filePicker = useItemFilePicker(item, files);
  useSlicerDropTarget(filePicker.keepFile);

  const hasPhotos = photos.length > 0;
  // No photo yet, but a model or slicer file: its plate picture is the cover until the first photo comes.
  const plate = hasPhotos ? undefined : plateCover(item);
  const hero = hasPhotos || !!plate;
  const reading = item.draft?.status === "reading";
  // The model card follows the note once typing pauses (half an address is not a model page yet).
  const settledNote = useSettled(note);
  const model = modelOf({ note: settledNote, draft: item.draft });
  // A model that lives somewhere else (a page, a file's address), not a file kept here: the page shows its card.
  const linkedModel = model && !model.url.startsWith("/api/files/") ? model : null;
  const modelPhoto = item.draft?.applied.includes("photos") ? photos.find((photo) => !photo.attemptId) : undefined;
  const modelPicture = modelPhoto ? { src: photoSrc(modelPhoto.id, "thumb"), color: modelPhoto.color } : undefined;
  // Its one name (shared/item-name.ts): what its cards, search and the palette call it, while the title stays empty.
  const lead = leadingLink(settledNote);
  // The page's title as soon as this page has it (its link card asks for the same preview), else the Worker's name.
  const { data: leadPreview } = useQuery({ ...linkPreviewQuery(lead ?? ""), enabled: !!lead });
  const linkTitle = lead && leadPreview?.title ? linkName(lead, leadPreview.title) : item.linkTitle;
  const name = itemName({ title, note: settledNote, stage: "idea", linkTitle });
  useDocumentTitle(name.text);
  const alt = photoAlt({ title, note, linkTitle: item.linkTitle });
  // Claude's title (decision 0070), for as long as it is still what it wrote: marked, and faded in when it arrives here.
  const named = !!item.claudeTitle && title === item.claudeTitle;
  const [untitled] = useState(!item.title);
  // While Claude names it (decision 0072) the title's place says so; a title typed here ends it at once.
  const naming = useNaming(item) && !title.trim();

  return (
    <PullToGo back={back} title={name.text}>
      <article className="pb-6">
        <h1 className="sr-only">{name.text}</h1>
        <DetailBar back={back} title={name.text}>
          {!deleting && <SaveStatus state={saveState} className="mr-2" />}
          {!deleting && <ShareLinkButton kind="item" id={item.id} title={name.text} what="idea" />}
          <ConfirmDelete
            asking={deleting}
            onAskingChange={setDeleting}
            onConfirm={remove}
            what="idea"
            disabled={readOnly}
            title={`Delete idea (${shortcutCaps("ideaDelete").join("")})`}
            ariaKeyshortcuts={ariaShortcuts("ideaDelete")}
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
        <div className={hero ? "flex flex-col gap-6 md:flex-row md:items-start md:gap-10 lg:gap-14" : "max-w-content"}>
          {hasPhotos && (
            <div ref={stickyColumn} className="sticky-column flex flex-col gap-4 md:min-w-0 md:flex-2 lg:flex-4">
              <PhotoViewer
                photos={photos}
                index={selectedIndex}
                onIndexChange={select}
                alt={alt}
                largeTitle={name.text}
                withStrip
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
          {plate && (
            <div ref={stickyColumn} className="sticky-column flex flex-col gap-4 md:min-w-0 md:flex-2 lg:flex-4">
              <PlateCover
                file={plate}
                alt={plateAlt({ title, note, linkTitle: item.linkTitle })}
                className="-mx-5 md:mx-0"
              />
              <AddFirstPhotos itemId={item.id} small />
            </div>
          )}

          <div className="max-w-content flex min-w-0 flex-col gap-3 md:flex-3 md:pt-2 lg:flex-5">
            {/* While Claude reads the page, the empty photo area and title hold their place with the quiet shimmer. */}
            {!hero &&
              (reading ? (
                <Skeleton className="mb-4 h-28 rounded-xl max-md:hidden" />
              ) : (
                <AddFirstPhotos itemId={item.id} />
              ))}
            {reading && !title.trim() ? (
              <Skeleton className="my-1.5 h-8 w-3/4" />
            ) : (
              <TextArea
                appearance="title"
                aria-label="Title"
                // The name it goes by, until someone types one: tidying up is one tap.
                placeholder={naming ? "Naming…" : name.text}
                borrowedPlaceholder={!naming && (name.from === "link" || name.from === "note")}
                minRows={1}
                maxLength={200}
                readOnly={titleKeep.readOnly}
                onFocus={titleKeep.onFocus}
                onBlur={titleKeep.onBlur}
                value={title}
                className={named && untitled ? "sg-arrive" : undefined}
                onChange={(event) => setTitle(event.target.value.replace(/\n/g, " "))}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === "Escape") {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }
                }}
              />
            )}
            {naming && (
              <ClaudeLine working className="-mt-2 md:-mt-1.5">
                {photos.some((photo) => !photo.attemptId) ? "Looking at the photo…" : "Reading the note…"}
              </ClaudeLine>
            )}
            {!naming && !title.trim() && !reading && <NameSourceLine from={name.from} className="-mt-2 md:-mt-1.5" />}
            {named && (
              <ClaudeLine className={cn("-mt-2 md:-mt-1.5", untitled && "sg-arrive")}>Named by Claude</ClaudeLine>
            )}
            <IdeaTitleChips item={item} forWhom={forWhom} setForWhom={setForWhom} readOnly={readOnly} />
            {/* No photo and no plate picture: on a phone one slim line, here under the title instead of two tiles above it. */}
            {!hero && !reading && <AddFirstPhotos itemId={item.id} row />}
            {filePicker.input}
            {/* The model's link shows once, as its card below: the note names it short, and has no card of its own. */}
            <NoteField
              value={note}
              onChange={setNote}
              readOnly={readOnly}
              model={linkedModel}
              modelCardBelow
              placeholder="Add a note: a link, a measurement, a half-thought…"
            />
            <NoteLinks note={note} model={linkedModel} modelShownElsewhere />
            {/* One model block under the note: the model's card, the files kept with the idea, and the quiet actions
              ("Make a twist", or "Twist" once one exists, sits beside "Add a file"). */}
            {linkedModel && (
              <LinkCard
                url={linkedModel.url}
                model={linkedModel}
                picture={modelPicture}
                titleShownAbove={
                  !title.trim() &&
                  name.from === "link" &&
                  !!lead &&
                  (lead === linkedModel.url || sameModel(lead, linkedModel.url))
                }
                className="max-w-content my-1"
              />
            )}
            <DraftNote item={item} title={title} note={note} readOnly={readOnly} />
            {files.length > 0 && (
              <Suspense fallback={null}>
                <ItemFiles itemId={item.id} files={files} readOnly={readOnly || item.pending} />
              </Suspense>
            )}
            <div className="-mx-3 -mt-1 flex flex-wrap items-center gap-x-1">
              <Button
                variant="quiet"
                icon={SlicerFileIcon}
                disabled={readOnly || item.pending}
                onClick={() => filePicker.open()}
              >
                Add a file
              </Button>
              {(model || existingTwist) && (
                <Button
                  variant="quiet"
                  icon={TwistIcon}
                  disabled={readOnly || item.pending || !user || !twists}
                  onClick={twist}
                >
                  {existingTwist ? "Twist" : "Make a twist"}
                </Button>
              )}
              {!item.pending && <OpenOnlyFile files={files} />}
            </div>

            <div className="text-small text-ink-faint mt-4 flex items-center gap-2.5">
              {person && <Avatar person={person} size="sm" via={via} />}
              <p>
                {person ? `${who(person)} captured this` : "Captured"}{" "}
                <time dateTime={new Date(item.createdAt).toISOString()} title={fullTime(item.createdAt)}>
                  {inlineTime(item.createdAt)}
                </time>
                {via && (
                  <>
                    {" "}
                    <ViaText name={via} person={person?.name} />
                  </>
                )}
              </p>
            </div>
            {after && !item.pending && (
              <ItemReactions
                itemId={item.id}
                reactions={item.reactions}
                noun="idea"
                readOnly={readOnly}
                className="mt-1"
              />
            )}
            {/* The conversation follows the words it is about, in the same column (as on a build). */}
            {after && !item.pending && (
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
          <ActionBar surface="tray">
            {/* One primary: starting a build. Moving into an existing one is the quiet word beside it. */}
            {/* Medium and with no icon, so "Start building" keeps its full pill (padding even on both sides) at 390. */}
            <Button variant="quiet" className="shrink-0" disabled={readOnly} onClick={move}>
              Add to a build
            </Button>
            <Button
              variant="primary"
              size="lg"
              icon={BuildsIcon}
              className="min-w-0 flex-1 px-4"
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
});
