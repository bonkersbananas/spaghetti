import type { Recipe } from "@shared/api";
import { type Outcome, tagLabel } from "@shared/attempts";
import { beganAsIdea } from "@shared/deleted";
import { isOffTheBed } from "@shared/print-progress";
import { recipesFor, settingsMaterial } from "@shared/recipes";
import { fullTime, inlineTime } from "@shared/time";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AnimatePresence, m } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { AttemptEntry } from "@/components/builds/AttemptEntry";
import { AttemptSheet } from "@/components/builds/AttemptSheet";
import { BuildSummary } from "@/components/builds/BuildSummary";
import { type ComparePair, CompareSheet } from "@/components/builds/CompareSheet";
import { OutcomeChip } from "@/components/builds/Outcome";
import { SettingsLine } from "@/components/builds/SettingsLine";
import { filamentLabel, summarizeSettings } from "@/components/builds/settings";
import { CommentThread } from "@/components/comments/CommentThread";
import { AddFirstPhotos } from "@/components/ideas/AddFirstPhotos";
import { photoAlt } from "@/components/ideas/IdeaCard";
import { PhotoStrip } from "@/components/ideas/PhotoStrip";
import { PhotoViewer } from "@/components/ideas/PhotoViewer";
import { EmptyPot, SpoolStrand } from "@/components/illustrations";
import { recipeKind } from "@/components/recipes/RecipeCard";
import { RecipeSheet } from "@/components/recipes/RecipeSheet";
import { SaveRecipeSheet } from "@/components/recipes/SaveRecipe";
import { DetailBar } from "@/components/shell/DetailBar";
import { ActionBar } from "@/components/ui/ActionBar";
import { Avatar } from "@/components/ui/Avatar";
import { Button, IconButton } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { TextArea } from "@/components/ui/Field";
import { ForField } from "@/components/ui/ForField";
import {
  ArrowRightIcon,
  BuildsIcon,
  CheckIcon,
  CommentIcon,
  CompareIcon,
  FinishIcon,
  IdeasIcon,
  PlusIcon,
  RecipeIcon,
  ReopenIcon,
  ShelveIcon,
  SparkleIcon,
  TrashIcon,
} from "@/components/ui/icons";
import { MetaList } from "@/components/ui/MetaList";
import { NoteField } from "@/components/ui/NoteField";
import { NoteLinks } from "@/components/ui/NoteLinks";
import { Overline } from "@/components/ui/Overline";
import { SaveStatus } from "@/components/ui/SaveStatus";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Skeleton } from "@/components/ui/Skeleton";
import { useVia } from "@/lib/agents";
import { deleteAttempt, finishBuild, heroPhoto, reopenBuild, shelveBuild, useTagOptions } from "@/lib/builds";
import { useCaptureHere } from "@/lib/capture";
import { shortcutCaps, useHotkeys } from "@/lib/hotkeys";
import {
  type AttemptView,
  deleteItem,
  discardIfUntouched,
  type ItemView,
  scrapBuild,
  useItem,
  useItemFields,
} from "@/lib/items";
import { scrollBehavior, spring } from "@/lib/motion";
import { useScreenActions } from "@/lib/palette";
import { peopleQuery } from "@/lib/queries";
import { canEdit, useReadOnly } from "@/lib/read-only";
import { itemName, useRememberItem } from "@/lib/recent";
import { canBeRecipe, type RecipeSourceAttempt, useRecipes } from "@/lib/recipes";
import { useSlicerDropTarget } from "@/lib/slicer-files";
import { useIsDesktop } from "@/lib/use-media-query";

export const Route = createFileRoute("/_app/builds/$buildId")({
  validateSearch: (search: Record<string, unknown>): { new?: boolean; attempt?: string; finish?: string } => ({
    ...(search.new === true || search.new === "true" ? { new: true } : {}),
    // Opened from the journal or search: that attempt is picked and in view.
    ...(typeof search.attempt === "string" && search.attempt ? { attempt: search.attempt } : {}),
    // From Today's Finish: open that attempt's sheet, with an outcome already picked ("success", "partial", "failed") or not ("1").
    ...(typeof search.finish === "string" && /^(1|success|partial|failed)$/.test(search.finish)
      ? { finish: search.finish }
      : {}),
  }),
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
  const { new: isNew, attempt: linkedAttempt, finish: finishParam } = Route.useSearch();
  const { data: people } = useQuery(peopleQuery);
  const byId = new Map(people?.map((person) => [person.id, person]));
  useCaptureHere(item);

  const { title, setTitle, note, setNote, forWhom, setForWhom, saveState } = useItemFields(item);

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
  const [sheet, setSheet] = useState<{
    open: boolean;
    attemptId: string | null;
    file?: { file: File; key: number } | null;
    /** An outcome picked already: on the attempt's card (a print off the bed) or on Today's "How did it go?". */
    outcome?: Outcome | null;
  }>({ open: false, attemptId: null });
  const openSheet = (attemptId: string | null, outcome?: Outcome) =>
    setSheet({ open: true, attemptId, file: null, outcome: outcome ?? null });
  // Today's Finish: open the attempt's sheet (with its outcome picked, if it came with one), then drop the
  // parameter so closing the sheet doesn't leave a link that reopens it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per arrival.
  useEffect(() => {
    if (!finishParam || !linkedAttempt) return;
    const attempt = item.attempts.find((candidate) => candidate.id === linkedAttempt);
    if (!attempt) return;
    if (attempt.outcome === null) openSheet(attempt.id, finishParam === "1" ? undefined : (finishParam as Outcome));
    void navigate({
      to: "/builds/$buildId",
      params: { buildId: item.id },
      search: { attempt: linkedAttempt },
      replace: true,
    });
  }, [finishParam, linkedAttempt, item.attempts.length]);
  // A .3mf dropped on the build starts a new attempt from it; dropped on an attempt, it goes on that one.
  useSlicerDropTarget((file, attemptId) => {
    const onto = attemptId ? item.attempts.find((attempt) => attempt.id === attemptId) : undefined;
    // Offline, a saved attempt is only for reading; a new attempt can still start from the file.
    if (onto && !canEdit(onto.pending)) return;
    const target = onto?.id ?? null;
    setSheet({ open: true, attemptId: target, file: { file, key: Date.now() } });
  });
  const primary = () => openSheet(printing?.id ?? null);
  const [selected, setSelected] = useState<string | null>(linkedAttempt ?? null);
  // Came here for one attempt: bring it into view.
  useEffect(() => {
    if (!linkedAttempt) return;
    setSelected(linkedAttempt);
    requestAnimationFrame(() => entryRefs.current.get(linkedAttempt)?.scrollIntoView({ block: "center" }));
  }, [linkedAttempt]);
  const selectedIndex = story.findIndex((attempt) => attempt.id === selected);
  const entryRefs = useRef(new Map<string, HTMLLIElement>());
  const moveSelection = (by: number) => {
    const next = story[Math.max(0, Math.min(story.length - 1, selectedIndex + by))];
    if (!next) return;
    setSelected(next.id);
    entryRefs.current.get(next.id)?.scrollIntoView({ block: "nearest", behavior: scrollBehavior() });
  };

  // Comparing an attempt with the one before it (the sheet; desktop can swap either side from its header).
  const [compare, setCompare] = useState<{ open: boolean; pair: ComparePair | null }>({ open: false, pair: null });
  const comparePredecessor = (attemptId: string) => {
    const index = item.attempts.findIndex((attempt) => attempt.id === attemptId);
    const before = item.attempts[index - 1];
    return index > 0 && before ? { before, attempt: item.attempts[index] } : null;
  };
  const openCompare = (attemptId: string) => {
    const found = comparePredecessor(attemptId);
    if (found) setCompare({ open: true, pair: { older: found.before.id, newer: attemptId } });
  };
  // V compares the picked attempt (else the newest) with the one before it.
  const compareTarget = selected ?? story[0]?.id;
  const compareFound = compareTarget ? comparePredecessor(compareTarget) : null;
  // The strip in the summary picks an attempt the way J and K do.
  const pickAttempt = (attemptId: string) => {
    setSelected(attemptId);
    entryRefs.current.get(attemptId)?.scrollIntoView({ block: "nearest", behavior: scrollBehavior() });
  };

  // When any attempt has more than one photo, every entry keeps room for their column so the lead photos match.
  const reserveExtras = story.some(
    (attempt) => item.photos.filter((photo) => photo.attemptId === attempt.id).length > 1,
  );

  const active = item.stage === "building";
  // A new build left empty removes itself when you leave it. Deferred a tick: React's dev double mount runs this cleanup too,
  // and the page is still the build's own then.
  // What is typed counts too, not only what is saved: autosave lags a keystroke by 600 ms.
  const latest = useRef(item);
  latest.current = { ...item, title: title || null, note: note || "" };
  const buildId = item.id;
  useEffect(
    () => () => {
      setTimeout(() => {
        if (window.location.pathname.includes(buildId)) return;
        discardIfUntouched(queryClient, latest.current);
      }, 0);
    },
    [buildId, queryClient],
  );
  // A build that began as an idea goes back to Ideas when it is removed; any other is deleted.
  const scrapsToIdea = !item.pending && beganAsIdea(item);
  function remove() {
    if (!canEdit(item.pending)) return;
    if (scrapsToIdea) {
      scrapBuild(queryClient, item);
      void navigate({ to: "/ideas" });
      return;
    }
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
  // Counts up each time something asks to write a comment: the M key, the palette.
  const [writeAsk, setWriteAsk] = useState(0);
  const comment = () => {
    if (canEdit(item.pending)) setWriteAsk((n) => n + 1);
  };
  useScreenActions("This build", [
    ...(compareFound?.attempt
      ? [
          {
            id: "compare",
            label: `Compare attempt ${compareFound.attempt.number} with attempt ${compareFound.before.number}`,
            icon: CompareIcon,
            shortcut: "buildCompare" as const,
            keywords: "compare diff difference versus side by side attempts",
            run: () => compareTarget && openCompare(compareTarget),
          },
        ]
      : []),
    {
      id: "log",
      label: printing ? "Finish attempt" : "Log attempt",
      icon: printing ? CheckIcon : PlusIcon,
      shortcut: "buildLog",
      keywords: "log attempt finish print outcome add",
      run: primary,
    },
    ...(active
      ? [
          {
            id: "finish",
            label: "Finish build",
            icon: FinishIcon,
            keywords: "done complete mark",
            run: () => canEdit(item.pending) && finishBuild(queryClient, item),
          },
          {
            id: "shelve",
            label: "Shelve build",
            icon: ShelveIcon,
            keywords: "pause archive",
            run: () => canEdit(item.pending) && shelveBuild(queryClient, item),
          },
        ]
      : [
          {
            id: "reopen",
            label: item.stage === "done" ? "Reopen build" : "Back on the bed",
            icon: ReopenIcon,
            keywords: "resume restart unshelve",
            run: () => canEdit(item.pending) && reopenBuild(queryClient, item),
          },
        ]),
    {
      id: "comment",
      label: "Say something about this build",
      icon: CommentIcon,
      shortcut: "buildComment",
      keywords: "comment message talk write reply chat",
      run: comment,
    },
  ]);
  useRememberItem({
    id: item.id,
    kind: "build",
    title: itemName(item, "build"),
    photo: hero ? { id: hero.id, color: hero.color } : null,
  });

  useHotkeys({
    buildBack: () => (selected ? setSelected(null) : void navigate({ to: "/builds" })),
    buildLog: primary,
    // Only bound when they do something, so Enter on a button and arrow-key scrolling keep working.
    buildNext: story.length ? () => moveSelection(1) : undefined,
    buildPrevious: story.length ? () => moveSelection(-1) : undefined,
    buildOpen: selected ? () => openSheet(selected) : undefined,
    buildCompare: compareFound && compareTarget ? () => openCompare(compareTarget) : undefined,
    buildPhotoPrevious: gallery.length > 1 ? () => selectPhoto(photoIndex - 1) : undefined,
    buildPhotoNext: gallery.length > 1 ? () => selectPhoto(photoIndex + 1) : undefined,
    buildDelete: deleteSelectedOrBuild,
    buildComment: item.pending ? undefined : comment,
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
  const [savingRecipe, setSavingRecipe] = useState<RecipeSourceAttempt | null>(null);
  const [openRecipe, setOpenRecipe] = useState<string | null>(null);
  const allRecipes = useRecipes();
  const recipeSource = (attempt: AttemptView): RecipeSourceAttempt | undefined =>
    canBeRecipe(attempt) && !attempt.pending && !readOnly
      ? { id: attempt.id, itemId: item.id, number: attempt.number, title: item.title, settings: attempt.settings }
      : undefined;
  const alt = photoAlt({ title, note });
  const creator = byId.get(item.createdBy);
  const via = useVia();

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
        <IconButton
          icon={TrashIcon}
          label={scrapsToIdea ? "Scrap build" : "Delete build"}
          disabled={readOnly}
          onClick={remove}
        />
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
            <ForField
              aria-label="For"
              value={forWhom}
              onChange={(event) => setForWhom(event.target.value)}
              readOnly={readOnly || item.pending}
            />
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
              <StageChip
                item={item}
                printing={!!printing}
                offBed={!!printing && isOffTheBed(printing)}
                celebrate={justFinished}
              />
              <div className="text-small text-ink-faint">
                {item.stage === "done" && item.finishedAt ? (
                  `Done ${inlineTime(item.finishedAt)}${item.attempts.length ? ` after ${attemptsWord}` : ""}`
                ) : item.stage === "shelved" && item.finishedAt ? (
                  `Shelved ${inlineTime(item.finishedAt)}`
                ) : item.attempts.length ? (
                  <MetaList>
                    <span className="whitespace-nowrap">{attemptsWord}</span>
                    <span className="whitespace-nowrap">started {inlineTime(started)}</span>
                  </MetaList>
                ) : (
                  `Started ${inlineTime(started)}`
                )}
              </div>
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
            <NoteLinks note={note} />
          </div>

          <BuildSummary attempts={item.attempts} open={active} onPick={pickAttempt} />

          {worked && (
            <WhatWorked
              attempt={worked}
              onOpen={() => openSheet(worked.id)}
              recipes={recipesFor(allRecipes, { material: settingsMaterial(worked.settings) }).slice(0, 2)}
              saved={allRecipes.some((recipe) => recipe.source?.attemptId === worked.id)}
              onSaveRecipe={recipeSource(worked) && (() => setSavingRecipe(recipeSource(worked) ?? null))}
              onOpenRecipe={setOpenRecipe}
            />
          )}
        </div>

        {/* The story: every attempt, newest first. */}
        <section aria-labelledby="story" className="flex min-w-0 flex-col md:flex-3">
          <div className="mb-4 flex items-center justify-between gap-3 md:mb-5">
            <SectionHeading id="story" count={item.attempts.length || undefined}>
              Attempts
            </SectionHeading>
            {isDesktop && (
              <Button
                variant={printing && isOffTheBed(printing) ? "secondary" : "primary"}
                icon={printing ? CheckIcon : PlusIcon}
                shortcut={shortcutCaps("buildLog")}
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
                    via={via(attempt.createdVia)}
                    selected={attempt.id === selected}
                    first={index === 0}
                    onOpen={() => {
                      setSelected(attempt.id);
                      openSheet(attempt.id);
                    }}
                    onFinish={(outcome) => openSheet(attempt.id, outcome)}
                    reserveExtras={reserveExtras}
                    onCompare={comparePredecessor(attempt.id) ? () => openCompare(attempt.id) : undefined}
                    onSaveRecipe={
                      recipeSource(attempt) && !allRecipes.some((recipe) => recipe.source?.attemptId === attempt.id)
                        ? () => setSavingRecipe(recipeSource(attempt) ?? null)
                        : undefined
                    }
                  />
                ))}
              </AnimatePresence>
            </ol>
          )}

          <div className="text-small text-ink-faint mt-1 flex items-center gap-3 pl-0.5">
            <span className="bg-ink/10 flex size-3 items-center justify-center rounded-full" aria-hidden />
            {creator && <Avatar person={creator} size="xs" via={via(item.createdVia)} />}
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

      {!item.pending && <CommentThread itemId={item.id} writeAsk={writeAsk} readOnly={readOnly} />}

      {/* A print that is off the bed asks its question on the attempt itself: one answer, not two. */}
      {!isDesktop && (active || printing) && !(printing && isOffTheBed(printing)) && (
        <ActionBar>
          <Button variant="primary" size="lg" icon={printing ? CheckIcon : PlusIcon} fullWidth onClick={primary}>
            {printing ? `Finish attempt ${printing.number}` : "Log attempt"}
          </Button>
        </ActionBar>
      )}

      <CompareSheet
        item={item}
        open={compare.open}
        onOpenChange={(open) => setCompare((current) => ({ ...current, open }))}
        pair={compare.pair}
        onPairChange={(pair) => setCompare({ open: true, pair })}
      />
      <AttemptSheet
        item={item}
        attemptId={sheet.attemptId}
        incomingFile={sheet.file}
        initialOutcome={sheet.outcome}
        open={sheet.open}
        onOpenChange={(open) => setSheet((current) => ({ ...current, open }))}
        onStep={(attemptId) => {
          setSheet((current) => ({ ...current, attemptId, file: null }));
          setSelected(attemptId);
        }}
      />
      <SaveRecipeSheet source={savingRecipe} onOpenChange={(open) => !open && setSavingRecipe(null)} />
      <RecipeSheet recipeId={openRecipe} onOpenChange={(open) => !open && setOpenRecipe(null)} />
    </article>
  );
}

/** Where a build stands, as a chip. Marking it done pops it, with a sparkle. */
function StageChip({
  item,
  printing,
  offBed,
  celebrate,
}: {
  item: ItemView;
  printing: boolean;
  offBed: boolean;
  celebrate: boolean;
}) {
  if (item.stage === "building") {
    return printing ? (
      <OutcomeChip outcome={null} offTheBed={offBed} />
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
    <m.span
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
        <m.span
          initial={{ opacity: 0, scale: 0.4, x: -4, y: 4 }}
          animate={{ opacity: [0, 1, 0], scale: [0.4, 1.2, 0.9], x: 6, y: -8 }}
          transition={{ duration: 0.9, ease: "easeOut" }}
          className="text-semolina absolute -top-1.5 -right-2.5"
          aria-hidden
        >
          <SparkleIcon size={16} weight="fill" />
        </m.span>
      )}
    </m.span>
  );
}

/**
 * The answer to "what worked last time": the latest attempt that came out right, in a line. Under it, the recipes
 * for its material, and "Save as recipe" to keep these settings under a name.
 */
function WhatWorked({
  attempt,
  onOpen,
  recipes,
  saved,
  onSaveRecipe,
  onOpenRecipe,
}: {
  attempt: AttemptView;
  onOpen: () => void;
  recipes: Recipe[];
  /** This attempt is already a recipe. */
  saved: boolean;
  onSaveRecipe?: () => void;
  onOpenRecipe: (id: string) => void;
}) {
  const successOptions = useTagOptions("success");
  const settings = summarizeSettings(attempt.settings);
  const filaments = attempt.settings.filaments ?? [];
  const readOnly = useReadOnly();
  return (
    <section aria-label="What worked" className="bg-basil-soft/60 flex flex-col rounded-lg">
      <button
        type="button"
        onClick={onOpen}
        className="pressable focus-ring hover:bg-basil-soft flex flex-col gap-2 rounded-lg p-4 text-left"
      >
        <Overline tone="basil">What worked · attempt {attempt.number}</Overline>
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
      {(recipes.length > 0 || onSaveRecipe || saved) && (
        <div className="flex flex-col gap-1 px-4 pb-3">
          {recipes.map((recipe) => (
            <button
              key={recipe.id}
              type="button"
              onClick={() => onOpenRecipe(recipe.id)}
              className="focus-ring text-small text-ink touch-target -mx-1 flex items-center gap-2 rounded-md px-1 py-1.5 text-left font-semibold"
            >
              <RecipeIcon size={18} aria-hidden className="shrink-0" />
              <span className="min-w-0 truncate">{recipe.name}</span>
              <span className="text-ink-faint font-medium whitespace-nowrap">{recipeKind(recipe)}</span>
              <ArrowRightIcon size={14} aria-hidden className="shrink-0" />
            </button>
          ))}
          {saved ? (
            <p className="text-small text-basil-ink flex items-center gap-1.5 px-0.5 py-1.5 font-semibold">
              <CheckIcon size={16} weight="bold" aria-hidden />
              Saved as a recipe
            </p>
          ) : (
            onSaveRecipe && (
              <Button
                variant="quiet"
                size="sm"
                icon={RecipeIcon}
                disabled={readOnly}
                onClick={onSaveRecipe}
                className="-ml-2 self-start"
              >
                Save as recipe
              </Button>
            )
          )}
        </div>
      )}
    </section>
  );
}
