import type { Recipe } from "@shared/api";
import { creditedTo, isOutcome, type Outcome, tagLabel } from "@shared/attempts";
import { beganAsIdea } from "@shared/deleted";
import { modelOf } from "@shared/model-mark";
import { attemptPartsLabel } from "@shared/parts";
import { isOffTheBed } from "@shared/print-progress";
import { recipesFor, settingsMaterial } from "@shared/recipes";
import { fullTime, inlineTime } from "@shared/time";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AnimatePresence } from "motion/react";
import { lazy, Suspense, startTransition, useEffect, useRef, useState } from "react";
import { AttemptEntry } from "@/components/builds/AttemptEntry";
import { AttemptRow } from "@/components/builds/AttemptRow";
import { AttemptSheet } from "@/components/builds/AttemptSheet";
import { BuildSummary } from "@/components/builds/BuildSummary";
import { BuildTitleLine } from "@/components/builds/BuildTitleLine";
import { type ComparePair, CompareSheet } from "@/components/builds/CompareSheet";
import { OpenOnlyFile, onlyOpenable } from "@/components/builds/OpenInStudio";
import { outcomeIcons, outcomeTones } from "@/components/builds/Outcome";
import { AddPartsButton, PartsSection } from "@/components/builds/parts/PartsSection";
import { SettingsLine } from "@/components/builds/SettingsLine";
import { filamentLabel, summarizeSettings } from "@/components/builds/settings";
import { CommentThread, ItemReactions } from "@/components/comments/CommentThread";
import { AddFirstPhotos } from "@/components/ideas/AddFirstPhotos";
import { photoAlt, plateAlt } from "@/components/ideas/IdeaCard";
import ItemFiles from "@/components/ideas/ItemFiles";
import { PhotoStrip } from "@/components/ideas/PhotoStrip";
import { PhotoViewer } from "@/components/ideas/PhotoViewer";
import { PlateCover } from "@/components/ideas/PlateCover";
import { EmptyPot } from "@/components/illustrations/EmptyPot";
import { SpoolStrand } from "@/components/illustrations/SpoolStrand";
import { recipeKind } from "@/components/recipes/RecipeCard";
import { RecipeSheet } from "@/components/recipes/RecipeSheet";
import { SaveRecipeSheet } from "@/components/recipes/SaveRecipe";
import { DetailBar } from "@/components/shell/DetailBar";
import { ActionBar } from "@/components/ui/ActionBar";
import { ActionMenuAskRow, ActionMenuItem, MoreMenu } from "@/components/ui/ActionMenu";
import { Avatar, ViaText } from "@/components/ui/Avatar";
import { Button, IconButton } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { ConfirmDelete } from "@/components/ui/ConfirmDelete";
import { EmptyState } from "@/components/ui/EmptyState";
import { TextArea } from "@/components/ui/Field";
import {
  ArrowRightIcon,
  CheckIcon,
  CommentIcon,
  CompareIcon,
  ExpandIcon,
  FinishIcon,
  IdeasIcon,
  PlusIcon,
  RecipeIcon,
  ReopenIcon,
  ShelveIcon,
  SlicerFileIcon,
  TrashIcon,
  TwistIcon,
} from "@/components/ui/icons";
import { NoteField } from "@/components/ui/NoteField";
import { NoteLinks } from "@/components/ui/NoteLinks";
import { Overline } from "@/components/ui/Overline";
import { PrinterMark } from "@/components/ui/PrinterMark";
import { PullToGo } from "@/components/ui/PullToGo";
import { SaveStatus } from "@/components/ui/SaveStatus";
import { Section } from "@/components/ui/Section";
import { ShareLinkButton } from "@/components/ui/ShareLinkButton";
import { Skeleton } from "@/components/ui/Skeleton";
import { useVia } from "@/lib/agents";
import { deleteAttempt, finishBuild, heroPhoto, reopenBuild, setCover, shelveBuild, useTagOptions } from "@/lib/builds";
import { useCaptureHere } from "@/lib/capture";
import { ariaShortcuts, shortcutCaps, useHotkeys } from "@/lib/hotkeys";
import {
  type AttemptView,
  addPhotosToItem,
  deleteItem,
  discardIfUntouched,
  type ItemView,
  itemQuery,
  scrapBuild,
  useItem,
  useItemFields,
} from "@/lib/items";
import { scrollBehavior } from "@/lib/motion";
import { useBackTo } from "@/lib/origin";
import { useScreenActions } from "@/lib/palette";
import { coverOf } from "@/lib/previews";
import { peopleQuery, sessionQuery } from "@/lib/queries";
import { canEdit, useKeepEditing, useReadOnly } from "@/lib/read-only";
import { itemName, useRememberItem } from "@/lib/recent";
import { canBeRecipe, type RecipeSourceAttempt, useRecipes } from "@/lib/recipes";
import { useSlicerDropTarget } from "@/lib/slicer-drop";
import { useStickyColumn } from "@/lib/sticky-column";
import { twistFromBuild, useTwists } from "@/lib/twists";
import { useItemFilePicker } from "@/lib/use-item-file-picker";
import { useAfterPaint, useIsDesktop } from "@/lib/use-media-query";
import { useWho } from "@/lib/who";

/** A build with more attempts than this shows only its newest few, with a line that unfolds the rest. */
const FOLD_AFTER = 5;
const SHOWN_ATTEMPTS = 3;

// "Move to another build" (decision 0076): loaded with the first tap on it.
const MoveAttemptSheet = lazy(() =>
  import("@/components/builds/MoveAttemptSheet").then((m) => ({ default: m.MoveAttemptSheet })),
);

export const Route = createFileRoute("/_app/builds/$buildId")({
  validateSearch: (search: Record<string, unknown>): { new?: boolean; attempt?: string; finish?: string } => ({
    ...(search.new === true || search.new === "true" ? { new: true } : {}),
    // Opened from the journal or search: that attempt is picked and in view.
    ...(typeof search.attempt === "string" && search.attempt ? { attempt: search.attempt } : {}),
    // From Today's Finish: open that attempt's sheet, with an outcome already picked ("success", "partial", "failed") or not ("1").
    ...(typeof search.finish === "string" && /^(1|open|success|partial|failed)$/.test(search.finish)
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
  // Taken back to an idea (undo, or on the other phone): it lives under Ideas again. Not when this page is already on
  // its way elsewhere: scrapping turns the build into an idea as it leaves for the Ideas list, whose code may still
  // be loading while this page shows (the router changes the address at once).
  useEffect(() => {
    if (!isIdea || window.location.pathname !== `/builds/${buildId}`) return;
    void navigate({ to: "/ideas/$ideaId", params: { ideaId: buildId }, replace: true });
  }, [isIdea, buildId, navigate]);
  // A printer's build that went into the build its print belongs to answers with that build (decision 0076): the
  // page moves to its real address, and the copy kept under the old one goes, so nothing edits it there.
  const queryClient = useQueryClient();
  const moved = !!item && item.id !== buildId;
  useEffect(() => {
    if (!moved || !item) return;
    queryClient.removeQueries({ queryKey: itemQuery(buildId).queryKey, exact: true });
    void navigate({ to: "/builds/$buildId", params: { buildId: item.id }, search: (prev) => prev, replace: true });
  }, [moved, item, buildId, navigate, queryClient]);
  if (item && !isIdea && !moved) return <Build key={item.id} item={item} />;
  return (
    <>
      <h1 className="sr-only">Build</h1>
      <DetailBar back={back} />
      {isPending || isIdea ? (
        <BuildSkeleton />
      ) : (
        <EmptyState
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

/** The page's shape while it loads, or for the moment it follows a sheet that opened first. */
function BuildSkeleton() {
  return (
    <div className="flex flex-col gap-6 md:flex-row md:gap-10" aria-hidden>
      <Skeleton className="-mx-5 aspect-4/3 w-[calc(100%+2.5rem)] rounded-none md:mx-0 md:w-auto md:flex-2 md:rounded-xl lg:flex-4" />
      <div className="flex flex-col gap-3 md:flex-3 lg:flex-5">
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-28 w-full rounded-lg" />
        <Skeleton className="h-28 w-full rounded-lg" />
      </div>
    </div>
  );
}

function Build({ item }: { item: ItemView }) {
  const stickyColumn = useStickyColumn();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const readOnly = useReadOnly(item.pending);
  const { new: isNew, attempt: linkedAttempt, finish: finishParam } = Route.useSearch();
  // The page was opened to answer one print ("How did it go?" or an outcome on its card), as it arrived.
  const [arrivingToAnswer] = useState(() => {
    if (!finishParam || !linkedAttempt) return undefined;
    const attempt = item.attempts.find((candidate) => candidate.id === linkedAttempt);
    return attempt && (attempt.outcome === null || finishParam === "open") ? attempt : undefined;
  });
  const { data: people } = useQuery(peopleQuery);
  const byId = new Map(people?.map((person) => [person.id, person]));
  useCaptureHere(item);
  const { data: user } = useQuery(sessionQuery);
  const who = useWho();
  // A build from someone else's model can be kept as a twist, once (it then says it prints it).
  const model = modelOf({ note: item.note, draft: item.draft });
  // A twist made from this item while it was an idea has `fromItemId` but not the build's `twistId`: it counts too.
  const { twists } = useTwists();
  const existingTwistId = item.twistId ?? twists?.find((twist) => twist.fromItemId === item.id)?.id ?? null;
  function saveAsTwist() {
    if (!user || !canEdit(item.pending) || !twists) return;
    if (existingTwistId) return void navigate({ to: "/twists/$twistId", params: { twistId: existingTwistId } });
    const id = twistFromBuild(
      queryClient,
      {
        id: item.id,
        title: item.title,
        note: item.note,
        photo: heroPhoto(item) ?? null,
        modelUrl: model && !model.url.startsWith("/api/files/") ? model.url : null,
      },
      user.id,
    );
    void navigate({ to: "/twists/$twistId", params: { twistId: id } });
  }

  const { title, setTitle, note, setNote, forWhom, setForWhom, saveState } = useItemFields(item);
  const titleKeep = useKeepEditing(readOnly);

  // Photos: the best one leads, then the build's own (from the idea, or added here).
  const hero = heroPhoto(item);
  const own = item.photos.filter((photo) => !photo.attemptId);
  // Then every attempt's, newest attempt first, whoever saved them: adding a photo never hides another.
  const attemptPhotos = [...item.attempts]
    .reverse()
    .flatMap((attempt) =>
      item.photos
        .filter((photo) => photo.attemptId === attempt.id)
        .map((photo) => ({ photo, attempt: attempt.number })),
    );
  const gallery = [...own, ...attemptPhotos.map((entry) => entry.photo)];
  // Without a photo, the cover rule's next step: the newest plate picture (coverOf in lib/previews.ts).
  const cover = coverOf(item);
  const plate = cover.kind === "plate" ? cover.file : undefined;
  const [editingParts, setEditingParts] = useState(false);
  // The photo the page leads with: an attempt card that has it doesn't show it large again (AttemptEntry's heroId).
  const leadPhotoId = (hero ?? gallery[0])?.id;
  // A photo picked in the strip stays shown until the lead itself changes (Finish build picks the final print, an
  // answer brings a better photo): then the page leads with the new one, as a reload would.
  const [picked, setPicked] = useState<{ id: string; lead: string | undefined } | null>(null);
  const photoId = picked && picked.lead === leadPhotoId ? picked.id : leadPhotoId;
  const photoIndex = Math.max(
    0,
    gallery.findIndex((photo) => photo.id === photoId),
  );
  const shownPhoto = gallery[photoIndex];
  const shownAttempt = shownPhoto?.attemptId ? item.attempts.find((a) => a.id === shownPhoto.attemptId) : undefined;
  const selectPhoto = (index: number) => {
    const photo = gallery[Math.max(0, Math.min(gallery.length - 1, index))];
    if (photo) setPicked({ id: photo.id, lead: leadPhotoId });
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
  }>(() =>
    arrivingToAnswer
      ? { open: true, attemptId: arrivingToAnswer.id, file: null, outcome: isOutcome(finishParam) ? finishParam : null }
      : { open: false, attemptId: null },
  );
  // Answering from a card (Today, the Journal's Now, Builds): the tap's first frame is the sheet, and the page behind
  // it follows a moment later in a transition that yields, so the tap answers within a frame on a slow phone too.
  const [bodyShown, setBodyShown] = useState(!arrivingToAnswer);
  useEffect(() => {
    if (bodyShown) return;
    const frame = requestAnimationFrame(() => startTransition(() => setBodyShown(true)));
    return () => cancelAnimationFrame(frame);
  }, [bodyShown]);
  const openSheet = (attemptId: string | null, outcome?: Outcome) =>
    setSheet({ open: true, attemptId, file: null, outcome: outcome ?? null });
  // Today's Finish: open the attempt's sheet (with its outcome picked, if it came with one), then drop the
  // parameter so closing the sheet doesn't leave a link that reopens it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per arrival.
  useEffect(() => {
    if (!finishParam || !linkedAttempt || !bodyShown) return;
    const attempt = item.attempts.find((candidate) => candidate.id === linkedAttempt);
    if (!attempt) return;
    // "open": the sheet followed its print here from another build (it moved), answered or not. Opened already when
    // the page arrived for it.
    if ((attempt.outcome === null || finishParam === "open") && !(sheet.open && sheet.attemptId === attempt.id))
      openSheet(attempt.id, isOutcome(finishParam) ? finishParam : undefined);
    void navigate({
      to: "/builds/$buildId",
      params: { buildId: item.id },
      search: { attempt: linkedAttempt },
      replace: true,
    });
  }, [finishParam, linkedAttempt, item.attempts.length, bodyShown]);
  // A .3mf dropped on the build starts a new attempt from it; dropped on an attempt, it goes on that one.
  useSlicerDropTarget((file, attemptId) => {
    const onto = attemptId ? item.attempts.find((attempt) => attempt.id === attemptId) : undefined;
    // Offline, a saved attempt is only for reading; a new attempt can still start from the file.
    if (onto && !canEdit(onto.pending)) return;
    const target = onto?.id ?? null;
    setSheet({ open: true, attemptId: target, file: { file, key: Date.now() } });
  });
  // A model or slicer file picked from the Files section (a drop on the build starts an attempt, above).
  const filePicker = useItemFilePicker(item, item.files ?? []);
  const primary = () => openSheet(printing?.id ?? null);
  const [selected, setSelected] = useState<string | null>(linkedAttempt ?? null);
  // The earlier attempts are compact rows; these were opened in place into cards (kept for this tab, so a reload or a
  // trip to another page and back finds them as they were left).
  const openedKey = `spaghetti:attempts-opened:${item.id}`;
  const [opened, setOpened] = useState<string[]>(() => {
    const kept = readOpened(openedKey);
    return linkedAttempt && !kept.includes(linkedAttempt) ? [...kept, linkedAttempt] : kept;
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(openedKey, JSON.stringify(opened));
    } catch {
      // Private mode or full: they fold again on reload, nothing more.
    }
  }, [openedKey, opened]);
  // Always a card: the newest attempt, a print on the bed or off it waiting for its answer, and one the printer asks
  // about; while a print is on the bed, the newest answered attempt too (that print is its next try: its note, its tags,
  // Claude's ideas). Every other attempt is a row until it is opened.
  const newestAnswered = story.find((attempt) => attempt.outcome !== null);
  const alwaysCard = (attempt: AttemptView) =>
    attempt.id === story[0]?.id ||
    attempt.outcome === null ||
    !!attempt.print?.asking ||
    (story[0]?.outcome === null && attempt.id === newestAnswered?.id);
  const isCard = (attempt: AttemptView) => alwaysCard(attempt) || opened.includes(attempt.id);
  const openRow = (attemptId: string) => setOpened((ids) => (ids.includes(attemptId) ? ids : [...ids, attemptId]));
  // Folding takes the focus back to the row, and opening to the card's own button, so a keyboard keeps its place.
  const focusAfter = useRef<string | null>(null);
  useEffect(() => {
    const id = focusAfter.current;
    if (!id) return;
    focusAfter.current = null;
    // The row's first button opens it; the card's first button opens its sheet.
    entryRefs.current.get(id)?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  });
  // Came here for one attempt: bring it into view.
  useEffect(() => {
    if (!linkedAttempt) return;
    setSelected(linkedAttempt);
    setOpened((ids) => (ids.includes(linkedAttempt) ? ids : [...ids, linkedAttempt]));
    requestAnimationFrame(() => entryRefs.current.get(linkedAttempt)?.scrollIntoView({ block: "center" }));
  }, [linkedAttempt]);
  const selectedIndex = story.findIndex((attempt) => attempt.id === selected);
  // A long build shows its newest attempts and folds the earlier ones behind one line, so the conversation under the
  // story stays near. An attempt picked by J/K, the summary's dots or a link unfolds them.
  const [showEarlier, setShowEarlier] = useState(
    () => !!linkedAttempt && story.findIndex((attempt) => attempt.id === linkedAttempt) >= SHOWN_ATTEMPTS,
  );
  const folds = story.length > FOLD_AFTER && !showEarlier;
  if (folds && selectedIndex >= SHOWN_ATTEMPTS) setShowEarlier(true);
  const shownStory = folds ? story.slice(0, SHOWN_ATTEMPTS) : story;
  const entryRefs = useRef(new Map<string, HTMLLIElement>());
  // The attempt to bring into view once it is on screen: a picked attempt that was folded away only mounts after the
  // render that unfolds the story, so the scroll waits for it here rather than looking it up at once.
  const scrollTo = useRef<string | null>(null);
  // At once when its entry is on screen; a folded one waits for the render that unfolds it (below).
  const bringIntoView = (attemptId: string) => {
    const entry = entryRefs.current.get(attemptId);
    if (entry) entry.scrollIntoView({ block: "nearest", behavior: scrollBehavior() });
    else scrollTo.current = attemptId;
  };
  useEffect(() => {
    const id = scrollTo.current;
    const entry = id ? entryRefs.current.get(id) : undefined;
    if (!entry) return;
    scrollTo.current = null;
    entry.scrollIntoView({ block: "nearest", behavior: scrollBehavior() });
  });
  const moveSelection = (by: number) => {
    const next = story[Math.max(0, Math.min(story.length - 1, selectedIndex + by))];
    if (!next) return;
    setSelected(next.id);
    bringIntoView(next.id);
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
    openRow(attemptId);
    bringIntoView(attemptId);
  };

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
  const attemptCount = item.attempts.length;
  const [deleting, setDeleting] = useState(false);
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
    } else if (deleting) remove();
    else if (canEdit(item.pending)) setDeleting(true);
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
            label: item.stage === "done" ? "Reopen build" : "Pick up again",
            icon: ReopenIcon,
            keywords: "resume restart unshelve",
            run: () => canEdit(item.pending) && reopenBuild(queryClient, item),
          },
        ]),
    {
      id: "remove",
      label: scrapsToIdea ? "Back to Ideas" : "Delete build",
      icon: scrapsToIdea ? IdeasIcon : TrashIcon,
      shortcut: "buildDelete" as const,
      keywords: scrapsToIdea ? "scrap idea undo mistake return" : "remove trash",
      run: () => canEdit(item.pending) && setDeleting(true),
    },
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

  // Escape lets go of the picked attempt first, then goes where the back control goes (where this build was opened from).
  const backTo = useBackTo(back);
  useHotkeys({
    buildBack: () => (selected ? setSelected(null) : backTo.go()),
    buildLog: primary,
    // Only bound when they do something, so Enter on a button and arrow-key scrolling keep working.
    buildNext: story.length ? () => moveSelection(1) : undefined,
    buildPrevious: story.length ? () => moveSelection(-1) : undefined,
    // A row opens in place first; a card opens its sheet.
    buildOpen: selected
      ? () => {
          const picked = story.find((attempt) => attempt.id === selected);
          if (picked && !isCard(picked)) openRow(picked.id);
          else openSheet(selected);
        }
      : undefined,
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

  const started = item.startedAt ?? item.createdAt;
  // The newest answered attempt worked and nothing is on the bed: the build's next step is to finish it.
  const lastAnswered = [...item.attempts].reverse().find((attempt) => attempt.outcome !== null);
  const finishNext = active && !printing && lastAnswered?.outcome === "success";
  const fromIdea = item.startedAt !== null && item.startedAt - item.createdAt > 60_000;
  const worked = [...item.attempts].reverse().find((attempt) => attempt.outcome === "success");
  // The finished attempts, and the one that came closest when none worked (the newest that worked partly).
  const tried = item.attempts.filter((attempt) => attempt.outcome !== null).length;
  const closest = worked ? undefined : [...item.attempts].reverse().find((attempt) => attempt.outcome === "partial");
  const [savingRecipe, setSavingRecipe] = useState<RecipeSourceAttempt | null>(null);
  // "Move to another build" from an attempt's "…" (decision 0076): the sheet's code comes with the first tap.
  const [movingId, setMovingId] = useState<string | null>(null);
  const [movingOpen, setMovingOpen] = useState(false);
  const movingAttempt = movingId ? item.attempts.find((attempt) => attempt.id === movingId) : undefined;
  const setMoving = (attemptId: string) => {
    setMovingId(attemptId);
    setMovingOpen(true);
  };
  const [openRecipe, setOpenRecipe] = useState<string | null>(null);
  // The sheets are closed on arrival: they mount once the page has painted (sooner if one is asked for at once).
  const afterPaint = useAfterPaint();
  const sheetsMounted = afterPaint || compare.open || sheet.open || !!savingRecipe || !!openRecipe;
  const allRecipes = useRecipes();
  const recipeSource = (attempt: AttemptView): RecipeSourceAttempt | undefined =>
    canBeRecipe(attempt) && !attempt.pending && !readOnly
      ? { id: attempt.id, itemId: item.id, number: attempt.number, title: item.title, settings: attempt.settings }
      : undefined;
  // R keeps the picked attempt as a recipe, else the newest one that worked, unless it is one already.
  const recipeTarget = selected ? story[selectedIndex] : worked;
  const recipeFrom =
    recipeTarget && !allRecipes.some((recipe) => recipe.source?.attemptId === recipeTarget.id)
      ? recipeSource(recipeTarget)
      : undefined;
  useHotkeys({ buildRecipe: recipeFrom ? () => setSavingRecipe(recipeFrom) : undefined });
  const alt = photoAlt({ title, note });
  const creator = byId.get(item.createdBy);
  const via = useVia();
  const madeVia = via(item.createdVia);

  // While a print is on the bed (decision 0066), ending the whole build is one menu away, not a button beside the
  // print's own question: standing at the printer, the thumb finds "How did it go?" and nothing that closes the build.
  // Once the print has its answer they are back where they were.
  const endsBuild = active && printing;
  // "Back to Ideas" lives here too: a sentence that says what it does, a menu away from the back link (it asks first).
  const closeMenu = (endsBuild || scrapsToIdea) && (
    <MoreMenu label="More for this build" title="Build" description={title.trim() || "Untitled build"}>
      {endsBuild && (
        <>
          <ActionMenuItem icon={FinishIcon} disabled={readOnly} onSelect={() => finishBuild(queryClient, item)}>
            Finish build
          </ActionMenuItem>
          <ActionMenuItem icon={ShelveIcon} disabled={readOnly} onSelect={() => shelveBuild(queryClient, item)}>
            Shelve build
          </ActionMenuItem>
        </>
      )}
      {scrapsToIdea && (
        <ActionMenuAskRow
          icon={IdeasIcon}
          disabled={readOnly}
          question="Back to Ideas?"
          detail={
            attemptCount > 0
              ? `Its ${attemptCount === 1 ? "attempt goes" : `${attemptCount} attempts go`} with it`
              : undefined
          }
          verb="Back to Ideas"
          onConfirm={remove}
          onAsk={() => setDeleting(true)}
        >
          Turn back into an idea
        </ActionMenuAskRow>
      )}
    </MoreMenu>
  );
  const stageActions = (
    <>
      {active ? (
        <>
          <Button variant="quiet" icon={ShelveIcon} disabled={readOnly} onClick={() => shelveBuild(queryClient, item)}>
            Shelve
          </Button>
          {/* On a phone the bar under the page already leads with it. */}
          {(isDesktop || !finishNext) && (
            <Button
              variant={isDesktop ? (finishNext ? "primary" : "secondary") : "quiet"}
              icon={FinishIcon}
              disabled={readOnly}
              onClick={() => finishBuild(queryClient, item)}
            >
              Finish build
            </Button>
          )}
        </>
      ) : (
        <Button icon={ReopenIcon} disabled={readOnly} onClick={() => reopenBuild(queryClient, item)}>
          {item.stage === "done" ? "Reopen" : "Pick up again"}
        </Button>
      )}
    </>
  );

  // What worked last time, or that nothing has yet. Under the title and its chips on a phone, where the page is long and
  // this is the answer; at the end of the column on a keyboard, beside the attempts.
  const workedRecipes = worked
    ? recipesFor(allRecipes, { material: settingsMaterial(worked.settings) }).slice(0, 2)
    : [];
  // Said once: an attempt that is a card on this page (the newest always is) has its note and tags right there, so the
  // What worked card keeps only the settings line and the recipes; one folded into a row keeps its note and tags too.
  const answer = worked ? (
    <WhatWorked
      compact={isCard(worked)}
      attempt={worked}
      onOpen={() => openSheet(worked.id)}
      material={settingsMaterial(worked.settings)}
      recipes={workedRecipes}
      saved={allRecipes.some((recipe) => recipe.source?.attemptId === worked.id)}
      onSaveRecipe={recipeSource(worked) && (() => setSavingRecipe(recipeSource(worked) ?? null))}
      onOpenRecipe={setOpenRecipe}
    />
  ) : tried > 0 ? (
    <NothingWorked tries={tried} closest={closest} onOpen={closest && (() => openSheet(closest.id))} />
  ) : null;

  return (
    <PullToGo back={back} title={title.trim() || "Untitled build"}>
      <article className="pb-6">
        <h1 className="sr-only">{title.trim() || "Untitled build"}</h1>
        <DetailBar back={back} title={title.trim() || "Untitled build"} hideBackOnPhone={deleting}>
          {!deleting && <SaveStatus state={saveState} className="mr-2" />}
          {deleting || endsBuild ? null : isDesktop ? (
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
          {!deleting && closeMenu}
          {!deleting && <ShareLinkButton kind="item" id={item.id} title={title.trim()} what="build" />}
          <ConfirmDelete
            asking={deleting}
            onAskingChange={setDeleting}
            onConfirm={remove}
            what="build"
            verb={scrapsToIdea ? "Back to Ideas" : "Delete"}
            question={scrapsToIdea ? "Back to Ideas?" : undefined}
            askOnly={scrapsToIdea}
            icon={scrapsToIdea ? IdeasIcon : undefined}
            detail={
              scrapsToIdea && attemptCount > 0
                ? `Its ${attemptCount === 1 ? "attempt goes" : `${attemptCount} attempts go`} with it`
                : undefined
            }
            disabled={readOnly}
            ariaKeyshortcuts={ariaShortcuts("buildDelete")}
          />
        </DetailBar>

        {!bodyShown ? (
          <BuildSkeleton />
        ) : (
          <div className="flex flex-col gap-8 md:flex-row md:items-start md:gap-10 lg:gap-14">
            {/* The build: its best photo large, its title and notes. */}
            <div ref={stickyColumn} className="sticky-column flex min-w-0 flex-col gap-4 md:flex-2 lg:flex-4">
              {gallery.length > 0 ? (
                <div className="relative">
                  <PhotoViewer
                    photos={gallery}
                    index={photoIndex}
                    onIndexChange={selectPhoto}
                    alt={alt}
                    className="-mx-5 md:mx-0"
                    capOnPhone={item.attempts.length > 0}
                    largeTitle={itemName(item, "build")}
                    withStrip
                  />
                  {shownAttempt && !(item.stage === "done" && shownPhoto?.id === hero?.id) && (
                    // Whose photo it is, where "Final print" sits: the attempt's name with how it went (and the printer's mark when it took the print).
                    <Chip
                      tone={isOutcome(shownAttempt.outcome) ? outcomeTones[shownAttempt.outcome] : "neutral"}
                      icon={isOutcome(shownAttempt.outcome) ? outcomeIcons[shownAttempt.outcome] : undefined}
                      onPhoto
                      className="shadow-soft absolute top-3 left-3"
                    >
                      {shownAttempt.fromPrinter && <PrinterMark size="xs" decorative />}
                      Attempt {shownAttempt.number}
                    </Chip>
                  )}
                  {item.stage === "done" && hero && gallery[photoIndex]?.id === hero.id && (
                    <Chip tone="basil" icon={FinishIcon} className="shadow-soft absolute top-3 left-3">
                      Final print
                    </Chip>
                  )}
                </div>
              ) : null}
              {gallery.length > 0 && (
                // The build's own photos (they reorder), then its attempts' (marked with their number), and a finished build's
                // cover is its final photo, not the first.
                <PhotoStrip
                  itemId={item.id}
                  photos={own}
                  attemptPhotos={attemptPhotos}
                  onCoverAttemptPhoto={(id) => setCover(queryClient, item.id, id)}
                  selectedId={gallery[photoIndex]?.id}
                  onSelect={(id) => setPicked({ id, lead: leadPhotoId })}
                  fixedCover={item.stage === "done" && !!item.coverPhotoId}
                  coverId={item.coverPhotoId}
                  onClearCover={() => setCover(queryClient, item.id, null)}
                />
              )}
              {gallery.length === 0 &&
                (plate ? (
                  // No photo yet, but a plate picture: it is the cover, where the idea had it and at its size, with
                  // the add-photo wells row-sized under it, as on the idea page. The first photo takes its place.
                  <>
                    <PlateCover file={plate} alt={plateAlt({ title, note })} className="-mx-5 md:mx-0" />
                    <AddFirstPhotos itemId={item.id} small />
                  </>
                ) : (
                  <AddFirstPhotos itemId={item.id} />
                ))}

              <div className="flex flex-col gap-3 md:pt-2">
                <TextArea
                  appearance="title"
                  aria-label="Title"
                  placeholder="Untitled build"
                  minRows={1}
                  maxLength={200}
                  // A new build from scratch: name it first (or don't).
                  autoFocus={isNew && isDesktop && !item.title}
                  readOnly={titleKeep.readOnly}
                  onFocus={titleKeep.onFocus}
                  onBlur={titleKeep.onBlur}
                  value={title}
                  onChange={(event) => setTitle(event.target.value.replace(/\n/g, " "))}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === "Escape") {
                      event.preventDefault();
                      event.currentTarget.blur();
                    }
                  }}
                />
                <BuildTitleLine
                  item={item}
                  printing={printing}
                  celebrate={justFinished}
                  forWhom={forWhom}
                  setForWhom={setForWhom}
                  readOnly={readOnly}
                >
                  {!active && !isDesktop && (
                    <Button
                      variant="quiet"
                      size="sm"
                      icon={ReopenIcon}
                      disabled={readOnly}
                      onClick={() => reopenBuild(queryClient, item)}
                    >
                      {item.stage === "done" ? "Reopen" : "Pick up again"}
                    </Button>
                  )}
                </BuildTitleLine>
                {/* No photo and no plate picture: on a phone one slim line here, not two tiles above the title. */}
                {gallery.length === 0 && !plate && <AddFirstPhotos itemId={item.id} row />}
                {/* What worked leads on a phone; when nothing has, the build's own note stays first (below). */}
                {!isDesktop && worked && answer}
                <NoteField
                  value={note}
                  onChange={setNote}
                  readOnly={readOnly}
                  placeholder="Notes for the whole build: the plan, a link, what to try next…"
                  model={model}
                  modelCardBelow
                  className="mt-1"
                />
                <NoteLinks note={note} model={model} />
                {/* The quiet action under the model, as on an idea: keep it as a twist, or open the one it prints. */}
                {(model ||
                  existingTwistId ||
                  onlyOpenable(item.files) ||
                  !item.parts.length ||
                  !item.files?.length) && (
                  <div className="-mx-3 -mt-1 flex flex-wrap items-center gap-x-1">
                    {(model || existingTwistId) && (
                      <Button
                        variant="quiet"
                        icon={TwistIcon}
                        disabled={readOnly || !user || !twists}
                        onClick={saveAsTwist}
                      >
                        {existingTwistId ? "Twist" : "Save as twist"}
                      </Button>
                    )}
                    {/* The first file: once the build has one, "Add a file" ends its Files list instead. */}
                    {!item.files?.length && (
                      <Button
                        variant="quiet"
                        icon={SlicerFileIcon}
                        disabled={readOnly || item.pending}
                        onClick={filePicker.open}
                      >
                        Add a file
                      </Button>
                    )}
                    <OpenOnlyFile files={item.files} />
                    {!item.parts.length && !editingParts && (
                      <AddPartsButton disabled={readOnly || item.pending} onClick={() => setEditingParts(true)} />
                    )}
                  </div>
                )}
                {!isDesktop && !worked && answer}
              </div>

              <BuildSummary
                attempts={item.attempts}
                photos={item.photos}
                open={active}
                onPick={pickAttempt}
                selected={selected}
              />

              {filePicker.input}
              {!!item.files?.length && (
                <ItemFiles
                  itemId={item.id}
                  files={item.files}
                  readOnly={readOnly || item.pending}
                  folded={item.attempts.length > 0 && !isDesktop}
                  onAdd={filePicker.open}
                />
              )}

              <PartsSection
                editing={editingParts}
                onEditing={setEditingParts}
                item={item}
                active={active}
                readOnly={readOnly}
                onFinishBuild={() => finishBuild(queryClient, item)}
              />

              {isDesktop && answer}
            </div>

            {/* The story: every attempt, newest first. */}
            {/* The story column: what happened, then the conversation about it, a section apart at every width. */}
            <div className="flex min-w-0 flex-col gap-12 md:flex-3 md:gap-16 lg:flex-5">
              <Section
                id="story"
                title="Attempts"
                count={item.attempts.length || undefined}
                aside={
                  // A print on the bed is asked about on its own card, so the section offers nothing beside it.
                  isDesktop &&
                  !printing && (
                    <Button
                      variant={finishNext ? "secondary" : "primary"}
                      icon={PlusIcon}
                      shortcut={shortcutCaps("buildLog")}
                      onClick={primary}
                    >
                      {finishNext ? "Log another try" : "Log attempt"}
                    </Button>
                  )
                }
              >
                {/* One child: the list and what follows it keep their own spacing, not the section's gap. */}
                <div className="flex flex-col">
                  {story.length === 0 ? (
                    <EmptyState
                      size="none"
                      className="bg-ink/3 max-w-none rounded-xl px-4 py-10"
                      illustration={<SpoolStrand />}
                      title="The water's still heating"
                    >
                      Log the first attempt when it comes off the bed, or start one now and finish it when the print is
                      done.
                    </EmptyState>
                  ) : (
                    <ol aria-label="Attempts, newest first" className="flex flex-col">
                      <AnimatePresence initial={false}>
                        {shownStory.map((attempt, index) => {
                          const ref = (el: HTMLLIElement | null) => {
                            if (el) entryRefs.current.set(attempt.id, el);
                            else entryRefs.current.delete(attempt.id);
                          };
                          const photos = item.photos.filter((photo) => photo.attemptId === attempt.id);
                          const person = byId.get(creditedTo(attempt) ?? "");
                          const onCompare = comparePredecessor(attempt.id) ? () => openCompare(attempt.id) : undefined;
                          const onSaveRecipe =
                            recipeSource(attempt) &&
                            !allRecipes.some((recipe) => recipe.source?.attemptId === attempt.id)
                              ? () => setSavingRecipe(recipeSource(attempt) ?? null)
                              : undefined;
                          const onMove = readOnly || attempt.pending ? undefined : () => setMoving(attempt.id);
                          if (!isCard(attempt))
                            return (
                              <AttemptRow
                                key={attempt.id}
                                ref={ref}
                                attempt={attempt}
                                photos={photos}
                                person={person}
                                selected={attempt.id === selected}
                                onExpand={() => {
                                  focusAfter.current = attempt.id;
                                  openRow(attempt.id);
                                }}
                                onCompare={onCompare}
                                onSaveRecipe={onSaveRecipe}
                                onMove={onMove}
                              />
                            );
                          const fold = !alwaysCard(attempt);
                          return (
                            <AttemptEntry
                              key={attempt.id}
                              ref={ref}
                              attempt={attempt}
                              partsLabel={attemptPartsLabel(attempt, item.parts)}
                              photos={photos}
                              heroId={leadPhotoId}
                              onFold={
                                fold
                                  ? () => {
                                      focusAfter.current = attempt.id;
                                      setOpened((ids) => ids.filter((id) => id !== attempt.id));
                                    }
                                  : undefined
                              }
                              onPhotos={readOnly ? undefined : (files) => addPhotosToItem(item.id, files, attempt.id)}
                              readOnly={readOnly || attempt.pending}
                              person={person}
                              via={via(attempt.createdVia)}
                              selected={attempt.id === selected}
                              first={index === 0}
                              onOpen={() => {
                                setSelected(attempt.id);
                                openSheet(attempt.id);
                              }}
                              onFinish={(outcome) => openSheet(attempt.id, outcome)}
                              askOnCard={isDesktop}
                              askShortcut={shortcutCaps("buildLog")}
                              onCompare={onCompare}
                              onSaveRecipe={onSaveRecipe}
                              item={item}
                              onMove={onMove}
                            />
                          );
                        })}
                      </AnimatePresence>
                    </ol>
                  )}

                  {folds && (
                    // On the rail like the line under it, so it reads as part of the story, not a stray button.
                    <div className="mb-1 flex items-center gap-3 pl-0.5">
                      <span className="bg-ink/10 size-3 shrink-0 rounded-full" aria-hidden />
                      <Button
                        variant="quiet"
                        size="sm"
                        icon={ExpandIcon}
                        onClick={() => setShowEarlier(true)}
                        className="-ml-2"
                      >
                        {story.length - SHOWN_ATTEMPTS} earlier attempts
                      </Button>
                    </div>
                  )}
                  <div className="text-small text-ink-faint mt-1 flex items-center gap-3 pl-0.5">
                    <span className="bg-ink/10 flex size-3 items-center justify-center rounded-full" aria-hidden />
                    {item.fromPrinter ? (
                      <PrinterMark size="xs" decorative />
                    ) : (
                      creator && <Avatar person={creator} size="xs" via={madeVia} />
                    )}
                    {fromIdea && <IdeasIcon size={16} className="-mr-1.5 shrink-0" aria-hidden />}
                    <p>
                      {item.fromPrinter ? (
                        // The printer made it for a print, not whoever paired the bridge (decision 0076).
                        "Made by the printer "
                      ) : fromIdea ? (
                        <>
                          {creator ? `${who(creator)} captured` : "Captured"} as an idea {inlineTime(item.createdAt)}
                          {madeVia && (
                            <>
                              {" "}
                              <ViaText name={madeVia} person={creator?.name} />
                            </>
                          )}
                          , building since{" "}
                        </>
                      ) : creator ? (
                        `${who(creator)} started `
                      ) : (
                        "Started "
                      )}
                      <time dateTime={new Date(started).toISOString()} title={fullTime(started)}>
                        {inlineTime(started)}
                      </time>
                      {!fromIdea && !item.fromPrinter && madeVia && (
                        <>
                          {" "}
                          <ViaText name={madeVia} person={creator?.name} />
                        </>
                      )}
                    </p>
                  </div>
                </div>
                {!item.pending && (
                  <ItemReactions
                    itemId={item.id}
                    reactions={item.reactions}
                    noun="build"
                    readOnly={readOnly}
                    className="mt-4"
                  />
                )}
              </Section>
              {!item.pending && afterPaint && (
                <CommentThread itemId={item.id} writeAsk={writeAsk} readOnly={readOnly} />
              )}
              {/* On a phone the closing actions stay the last thing on the page, quiet beside the primary action bar. */}
              {!isDesktop && active && !printing && (
                <div className="-mt-6 flex items-center justify-center gap-3 md:-mt-8">{stageActions}</div>
              )}
            </div>
          </div>
        )}

        {/* A print still printing is asked about here, within thumb reach (its card shows only how far along it is);
            one that is off the bed asks on the attempt itself, with its three answers: one question, never two. */}
        {bodyShown && !isDesktop && (active || printing) && !(printing && isOffTheBed(printing)) && (
          <ActionBar>
            {finishNext ? (
              // As the idea's bar: the second action a quiet word on the left, the one primary on the thumb's side.
              <>
                <Button variant="quiet" className="shrink-0" onClick={primary}>
                  Log another try
                </Button>
                <Button
                  variant="primary"
                  size="lg"
                  icon={FinishIcon}
                  disabled={readOnly}
                  className="min-w-0 flex-1 px-4"
                  onClick={() => finishBuild(queryClient, item)}
                >
                  Finish build
                </Button>
              </>
            ) : (
              <Button variant="primary" size="lg" icon={printing ? undefined : PlusIcon} fullWidth onClick={primary}>
                {printing ? "How did it go?" : "Log attempt"}
              </Button>
            )}
          </ActionBar>
        )}

        {sheetsMounted && (
          <>
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
            {movingAttempt && (
              <Suspense fallback={null}>
                <MoveAttemptSheet open={movingOpen} onOpenChange={setMovingOpen} item={item} attempt={movingAttempt} />
              </Suspense>
            )}
            <RecipeSheet recipeId={openRecipe} onOpenChange={(open) => !open && setOpenRecipe(null)} />
          </>
        )}
      </article>
    </PullToGo>
  );
}

/**
 * The same place when nothing has worked yet: said plainly, in Search's words, with the closest try (a partly) one tap
 * away. Neutral, not basil: it is a fact, not a failure.
 */
function NothingWorked({ tries, closest, onOpen }: { tries: number; closest?: AttemptView; onOpen?: () => void }) {
  return (
    <section aria-label="What worked" className="bg-semolina-soft flex flex-col gap-1 rounded-lg p-4">
      <Overline tone="semolina">What worked</Overline>
      <p className="text-body text-ink font-semibold">Nothing has worked for this yet.</p>
      <p className="text-small text-ink">
        Not al dente yet. {tries === 1 ? "One try so far." : `${tries} tries so far.`}
        {closest && onOpen && (
          <>
            {" "}
            <button
              type="button"
              onClick={onOpen}
              className="focus-ring touch-target relative rounded-xs font-semibold underline underline-offset-2"
            >
              Attempt {closest.number} came closest
            </button>{" "}
            (partly).
          </>
        )}
      </p>
    </section>
  );
}

/**
 * The answer to "what worked last time": the latest attempt that came out right, in a line. Under it, the recipes
 * for its material, and "Save as recipe" to keep these settings under a name.
 */
function WhatWorked({
  compact,
  material,
  attempt,
  onOpen,
  recipes,
  saved,
  onSaveRecipe,
  onOpenRecipe,
}: {
  /** The attempt is a card on this page already: its note and tags aren't said again. */
  compact?: boolean;
  /** Its material ("PLA"), which the recipes below are for. */
  material: string | null;
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
        {!compact && attempt.note && (
          <span className="text-body text-ink line-clamp-3 md:line-clamp-none">{attempt.note}</span>
        )}
        {!compact && attempt.successNotes.length > 0 && (
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
          {recipes.length > 0 && (
            <Overline tone="basil" className="pt-1">
              Recipes for {material ?? "this filament"}
            </Overline>
          )}
          {recipes.map((recipe) => (
            <button
              key={recipe.id}
              type="button"
              onClick={() => onOpenRecipe(recipe.id)}
              className="focus-ring text-small text-ink touch-target relative -mx-1 flex items-center gap-2 rounded-md px-1 py-1.5 text-left font-semibold"
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

/** The attempts opened from their rows in this tab, kept under `key` in sessionStorage. */
function readOpened(key: string): string[] {
  try {
    const kept: unknown = JSON.parse(sessionStorage.getItem(key) ?? "[]");
    return Array.isArray(kept) ? kept.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}
