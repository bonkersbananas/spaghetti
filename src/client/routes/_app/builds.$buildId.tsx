import { tagLabel } from "@shared/attempts";
import { fullTime, inlineTime } from "@shared/time";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { AttemptEntry } from "@/components/builds/AttemptEntry";
import { AttemptSheet } from "@/components/builds/AttemptSheet";
import { OutcomeChip } from "@/components/builds/Outcome";
import { SettingsLine } from "@/components/builds/SettingsLine";
import { filamentLabel, summarizeSettings } from "@/components/builds/settings";
import { AddFirstPhotos } from "@/components/ideas/AddFirstPhotos";
import { photoAlt } from "@/components/ideas/IdeaCard";
import { PhotoStrip } from "@/components/ideas/PhotoStrip";
import { PhotoViewer } from "@/components/ideas/PhotoViewer";
import { EmptyPot, SpoolStrand } from "@/components/illustrations";
import { DetailBar } from "@/components/shell/DetailBar";
import { ActionBar } from "@/components/ui/ActionBar";
import { Avatar } from "@/components/ui/Avatar";
import { Button, IconButton } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { TextArea } from "@/components/ui/Field";
import {
  BuildsIcon,
  CheckIcon,
  FinishIcon,
  IdeasIcon,
  PlusIcon,
  ReopenIcon,
  ShelveIcon,
  SparkleIcon,
  TrashIcon,
} from "@/components/ui/icons";
import { NoteField } from "@/components/ui/NoteField";
import { SaveStatus } from "@/components/ui/SaveStatus";
import { Skeleton } from "@/components/ui/Skeleton";
import { deleteAttempt, finishBuild, heroPhoto, reopenBuild, shelveBuild, useTagOptions } from "@/lib/builds";
import { useCaptureHere } from "@/lib/capture";
import { cn } from "@/lib/cn";
import { useHotkeys } from "@/lib/hotkeys";
import { type AttemptView, deleteItem, type ItemView, saveItemChanges, useItem } from "@/lib/items";
import { spring } from "@/lib/motion";
import { peopleQuery } from "@/lib/queries";
import { canEdit, useReadOnly } from "@/lib/read-only";
import { useAutosave, useFollowServer } from "@/lib/use-autosave";
import { useIsDesktop } from "@/lib/use-media-query";

export const Route = createFileRoute("/_app/builds/$buildId")({
  validateSearch: (search: Record<string, unknown>): { new?: boolean } =>
    search.new === true || search.new === "true" ? { new: true } : {},
  component: BuildDetail,
});

const back = { to: "/builds", label: "Builds" } as const;

function BuildDetail() {
  const { buildId } = Route.useParams();
  const { item, isPending, error } = useItem(buildId);
  const navigate = useNavigate();
  const isIdea = item?.stage === "idea";
  // Taken back to an idea (undo, or on the other phone): it lives under Ideas again.
  useEffect(() => {
    if (isIdea) void navigate({ to: "/ideas/$ideaId", params: { ideaId: buildId }, replace: true });
  }, [isIdea, buildId, navigate]);
  if (item && !isIdea) return <Build key={item.id} item={item} />;
  return (
    <>
      <h1 className="sr-only">Build</h1>
      <DetailBar back={back} />
      {isPending || isIdea ? (
        <div className="flex flex-col gap-6 md:flex-row md:gap-10" aria-hidden>
          <Skeleton className="-mx-5 aspect-4/3 rounded-none md:mx-0 md:flex-2 md:rounded-xl" />
          <div className="flex flex-col gap-3 md:flex-3">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-28 w-full rounded-lg" />
            <Skeleton className="h-28 w-full rounded-lg" />
          </div>
        </div>
      ) : (
        <EmptyState
          className="py-10 md:py-20"
          illustration={<EmptyPot />}
          title={error ? "This one is out of reach" : "This one boiled over"}
          action={
            <Link to="/builds" className="focus-ring rounded-md">
              <Button variant="secondary" tabIndex={-1}>
                Back to builds
              </Button>
            </Link>
          }
        >
          {error
            ? "It can't load without a connection. It will be here when you're back."
            : "This build was deleted, or it never made it here."}
        </EmptyState>
      )}
    </>
  );
}

function Build({ item }: { item: ItemView }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const readOnly = useReadOnly(item.pending);
  const { new: isNew } = Route.useSearch();
  const { data: people } = useQuery(peopleQuery);
  const byId = new Map(people?.map((person) => [person.id, person]));
  useCaptureHere(item);

  const [title, setTitle] = useState(item.title ?? "");
  const [note, setNote] = useState(item.note);
  // Notes added from the capture sheet, or edits by the other person, arrive from outside: show them.
  useFollowServer(item.title ?? "", title, setTitle);
  useFollowServer(item.note, note, setNote);
  const saveState = useAutosave({ title, note }, (value) =>
    saveItemChanges(queryClient, item.id, { title: value.title.trim() || null, note: value.note }),
  );

  // Photos: the best one leads, then the build's own (from the idea, or added here).
  const hero = heroPhoto(item);
  const own = item.photos.filter((photo) => !photo.attemptId);
  const gallery = hero && !own.some((photo) => photo.id === hero.id) ? [hero, ...own] : own;
  const [photoId, setPhotoId] = useState(gallery[0]?.id);
  const photoIndex = Math.max(
    0,
    gallery.findIndex((photo) => photo.id === photoId),
  );
  const selectPhoto = (index: number) => {
    const photo = gallery[Math.max(0, Math.min(gallery.length - 1, index))];
    if (photo) setPhotoId(photo.id);
  };

  // The story, newest first.
  const story = [...item.attempts].reverse();
  const printing = story.find((attempt) => attempt.outcome === null);
  const [sheet, setSheet] = useState<{ open: boolean; attemptId: string | null }>({ open: false, attemptId: null });
  const openSheet = (attemptId: string | null) => setSheet({ open: true, attemptId });
  // Finishing a saved print changes it on the server: it waits for the connection (logging a new attempt doesn't).
  const offline = useReadOnly();
  const finishLocked = !!printing && offline && !printing.pending;
  const primary = () => {
    if (printing && !canEdit(printing.pending)) return;
    openSheet(printing?.id ?? null);
  };
  const [selected, setSelected] = useState<string | null>(null);
  const selectedIndex = story.findIndex((attempt) => attempt.id === selected);
  const entryRefs = useRef(new Map<string, HTMLLIElement>());
  const moveSelection = (by: number) => {
    const next = story[Math.max(0, Math.min(story.length - 1, selectedIndex + by))];
    if (!next) return;
    setSelected(next.id);
    entryRefs.current.get(next.id)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  const active = item.stage === "building";
  function remove() {
    if (!canEdit(item.pending)) return;
    deleteItem(queryClient, item);
    void navigate({ to: "/builds" });
  }

  const deleteSelectedOrBuild = () => {
    const attempt = story[selectedIndex];
    if (attempt) {
      if (!canEdit(attempt.pending)) return;
      deleteAttempt(queryClient, item.id, attempt);
      setSelected(null);
    } else remove();
  };
  useHotkeys({
    escape: () => (selected ? setSelected(null) : void navigate({ to: "/builds" })),
    a: primary,
    // Only bound when they do something, so Enter on a button and arrow-key scrolling keep working.
    ...(story.length
      ? {
          arrowdown: () => moveSelection(1),
          arrowup: () => moveSelection(-1),
          j: () => moveSelection(1),
          k: () => moveSelection(-1),
        }
      : {}),
    ...(selected ? { enter: () => openSheet(selected) } : {}),
    ...(gallery.length > 1
      ? { arrowleft: () => selectPhoto(photoIndex - 1), arrowright: () => selectPhoto(photoIndex + 1) }
      : {}),
    backspace: deleteSelectedOrBuild,
    delete: deleteSelectedOrBuild,
  });

  // The moment a build that took some failing gets marked done.
  const [justFinished, setJustFinished] = useState(false);
  const stage = useRef(item.stage);
  useEffect(() => {
    if (stage.current !== "done" && item.stage === "done") setJustFinished(true);
    stage.current = item.stage;
  }, [item.stage]);

  const attemptsWord = `${item.attempts.length} ${item.attempts.length === 1 ? "attempt" : "attempts"}`;
  const started = item.startedAt ?? item.createdAt;
  const fromIdea = item.startedAt !== null && item.startedAt - item.createdAt > 60_000;
  const worked = [...item.attempts].reverse().find((attempt) => attempt.outcome === "success");
  const alt = photoAlt({ title, note });
  const creator = byId.get(item.createdBy);

  const stageActions = (
    <>
      {active ? (
        <>
          <Button variant="quiet" icon={ShelveIcon} disabled={readOnly} onClick={() => shelveBuild(queryClient, item)}>
            Shelve
          </Button>
          <Button icon={FinishIcon} disabled={readOnly} onClick={() => finishBuild(queryClient, item)}>
            Finish build
          </Button>
        </>
      ) : (
        <Button icon={ReopenIcon} disabled={readOnly} onClick={() => reopenBuild(queryClient, item)}>
          {item.stage === "done" ? "Reopen" : "Back on the bed"}
        </Button>
      )}
    </>
  );

  return (
    <article className="pb-6">
      <h1 className="sr-only">{title.trim() || "Untitled build"}</h1>
      <DetailBar back={back}>
        <SaveStatus state={saveState} className="mr-2" />
        {isDesktop ? (
          <span className="mr-2 flex items-center gap-2">{stageActions}</span>
        ) : (
          active && (
            <IconButton
              icon={ShelveIcon}
              label="Shelve build"
              disabled={readOnly}
              onClick={() => shelveBuild(queryClient, item)}
            />
          )
        )}
        <IconButton icon={TrashIcon} label="Delete build" disabled={readOnly} onClick={remove} />
      </DetailBar>

      <div className="flex flex-col gap-8 md:flex-row md:items-start md:gap-10 lg:gap-14">
        {/* The build: its best photo large, its title and notes. */}
        <div className="flex min-w-0 flex-col gap-4 md:sticky md:top-8 md:flex-2">
          {gallery.length > 0 ? (
            <div className="relative">
              <PhotoViewer
                photos={gallery}
                index={photoIndex}
                onIndexChange={selectPhoto}
                alt={alt}
                className="-mx-5 md:mx-0"
              />
              {item.stage === "done" && hero && gallery[photoIndex]?.id === hero.id && (
                <Chip tone="basil" icon={FinishIcon} className="shadow-soft absolute top-3 left-3">
                  Final print
                </Chip>
              )}
            </div>
          ) : null}
          {gallery.length > 0 && (
            <PhotoStrip itemId={item.id} photos={own} selectedId={gallery[photoIndex]?.id} onSelect={setPhotoId} />
          )}
          {gallery.length === 0 && <AddFirstPhotos itemId={item.id} />}

          <div className="flex flex-col gap-3 md:pt-2">
            <TextArea
              appearance="title"
              aria-label="Title"
              placeholder="Untitled build"
              minRows={1}
              maxLength={200}
              // A new build from scratch: name it first (or don't).
              autoFocus={isNew && isDesktop && !item.title}
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
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
              <StageChip item={item} printing={!!printing} celebrate={justFinished} />
              <p className="text-small text-ink-faint">
                {item.stage === "done" && item.finishedAt
                  ? `Done ${inlineTime(item.finishedAt)}${item.attempts.length ? ` after ${attemptsWord}` : ""}`
                  : item.stage === "shelved" && item.finishedAt
                    ? `Shelved ${inlineTime(item.finishedAt)}`
                    : item.attempts.length
                      ? `${attemptsWord} · started ${inlineTime(started)}`
                      : `Started ${inlineTime(started)}`}
              </p>
              {!active && !isDesktop && (
                <Button
                  variant="quiet"
                  size="sm"
                  icon={ReopenIcon}
                  disabled={readOnly}
                  onClick={() => reopenBuild(queryClient, item)}
                >
                  {item.stage === "done" ? "Reopen" : "Back on the bed"}
                </Button>
              )}
            </div>
            <NoteField
              value={note}
              onChange={setNote}
              readOnly={readOnly}
              placeholder="Notes for the whole build: the plan, a link, what to try next…"
              className="mt-1"
            />
          </div>

          {worked && <WhatWorked attempt={worked} onOpen={() => openSheet(worked.id)} />}
        </div>

        {/* The story: every attempt, newest first. */}
        <section aria-labelledby="story" className="flex min-w-0 flex-col md:flex-3">
          <div className="mb-4 flex items-center justify-between gap-3 md:mb-5">
            <h2 id="story" className="text-headline text-ink">
              Attempts
              {item.attempts.length > 0 && (
                <span className="text-small text-ink-faint tabular ml-2 align-middle font-sans font-semibold">
                  {item.attempts.length}
                </span>
              )}
            </h2>
            {isDesktop && (
              <Button
                variant="primary"
                icon={printing ? CheckIcon : PlusIcon}
                shortcut={["A"]}
                disabled={finishLocked}
                onClick={primary}
              >
                {printing ? `Finish attempt ${printing.number}` : "Log attempt"}
              </Button>
            )}
          </div>

          {story.length === 0 ? (
            <EmptyState
              className="bg-ink/3 max-w-none rounded-xl px-4 py-10"
              illustration={<SpoolStrand />}
              title="The water's still heating"
            >
              Log the first attempt when it comes off the bed, or start one now and finish it when the print is done.
            </EmptyState>
          ) : (
            <ol aria-label="Attempts, newest first" className="flex flex-col">
              <AnimatePresence initial={false}>
                {story.map((attempt, index) => (
                  <AttemptEntry
                    key={attempt.id}
                    ref={(el) => {
                      if (el) entryRefs.current.set(attempt.id, el);
                      else entryRefs.current.delete(attempt.id);
                    }}
                    attempt={attempt}
                    photos={item.photos.filter((photo) => photo.attemptId === attempt.id)}
                    person={byId.get(attempt.createdBy)}
                    selected={attempt.id === selected}
                    first={index === 0}
                    onOpen={() => {
                      setSelected(attempt.id);
                      openSheet(attempt.id);
                    }}
                    onFinish={() => openSheet(attempt.id)}
                  />
                ))}
              </AnimatePresence>
            </ol>
          )}

          <div className="text-small text-ink-faint mt-1 flex items-center gap-3 pl-0.5">
            <span className="bg-ink/10 flex size-3 items-center justify-center rounded-full" aria-hidden />
            {creator && <Avatar person={creator} size="xs" />}
            {fromIdea && <IdeasIcon size={16} className="-mr-1.5 shrink-0" aria-hidden />}
            <p>
              {fromIdea ? <>Captured as an idea {inlineTime(item.createdAt)}, building since </> : "Started "}
              <time dateTime={new Date(started).toISOString()} title={fullTime(started)}>
                {inlineTime(started)}
              </time>
            </p>
          </div>

          {!isDesktop && active && <div className="mt-8 flex items-center justify-center gap-3">{stageActions}</div>}
        </section>
      </div>

      {!isDesktop && (active || printing) && (
        <ActionBar>
          <Button
            variant="primary"
            size="lg"
            icon={printing ? CheckIcon : PlusIcon}
            fullWidth
            disabled={finishLocked}
            onClick={primary}
          >
            {printing ? `Finish attempt ${printing.number}` : "Log attempt"}
          </Button>
        </ActionBar>
      )}

      <AttemptSheet
        item={item}
        attemptId={sheet.attemptId}
        open={sheet.open}
        onOpenChange={(open) => setSheet((current) => ({ ...current, open }))}
      />
    </article>
  );
}

/** Where a build stands, as a chip. Marking it done pops it, with a sparkle. */
function StageChip({ item, printing, celebrate }: { item: ItemView; printing: boolean; celebrate: boolean }) {
  if (item.stage === "building") {
    return printing ? (
      <OutcomeChip outcome={null} />
    ) : (
      <Chip tone="semolina" icon={BuildsIcon}>
        On the bed
      </Chip>
    );
  }
  if (item.stage === "shelved") {
    return <Chip icon={ShelveIcon}>Shelved</Chip>;
  }
  return (
    <motion.span
      key={celebrate ? "celebrate" : "done"}
      initial={celebrate ? { scale: 0.5, rotate: -10, opacity: 0 } : false}
      animate={{ scale: 1, rotate: 0, opacity: 1 }}
      transition={spring.snappy}
      className="relative inline-flex"
    >
      <Chip tone="basil" icon={FinishIcon}>
        Done
      </Chip>
      {celebrate && (
        <motion.span
          initial={{ opacity: 0, scale: 0.4, x: -4, y: 4 }}
          animate={{ opacity: [0, 1, 0], scale: [0.4, 1.2, 0.9], x: 6, y: -8 }}
          transition={{ duration: 0.9, ease: "easeOut" }}
          className="text-semolina absolute -top-1.5 -right-2.5"
          aria-hidden
        >
          <SparkleIcon size={16} weight="fill" />
        </motion.span>
      )}
    </motion.span>
  );
}

/** The answer to "what worked last time": the latest attempt that came out right, in a line. */
function WhatWorked({ attempt, onOpen }: { attempt: AttemptView; onOpen: () => void }) {
  const successOptions = useTagOptions("success");
  const settings = summarizeSettings(attempt.settings);
  const filaments = attempt.settings.filaments ?? [];
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "pressable focus-ring bg-basil-soft/60 hover:bg-basil-soft flex flex-col gap-2 rounded-lg p-4 text-left",
      )}
    >
      <span className="text-caption text-basil-ink font-semibold tracking-wider uppercase">
        What worked · attempt {attempt.number}
      </span>
      <SettingsLine
        filaments={filaments}
        parts={settings}
        name={filamentLabel}
        className="text-small text-ink-soft"
        filamentClassName="text-ink"
      />
      {attempt.note && <span className="text-body text-ink">{attempt.note}</span>}
      {attempt.successNotes.length > 0 && (
        <span className="flex flex-wrap gap-1.5">
          {attempt.successNotes.map((slug) => (
            <Chip key={slug} tone="basil" icon={CheckIcon} className="bg-cream/70">
              {tagLabel("success", slug, successOptions)}
            </Chip>
          ))}
        </span>
      )}
    </button>
  );
}
