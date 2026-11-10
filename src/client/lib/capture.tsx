import type { ItemStage } from "@shared/api";
import type { Outcome } from "@shared/attempts";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "@/components/ui/Toast";
import { queueFinish, saveAttemptChanges } from "./builds";
import { isOnline } from "./connection";
import { type ProcessedPhoto, processPhoto, UnreadablePhotoError } from "./images";
import { cachedItem, type ItemView, ideasQuery, saveItemChanges } from "./items";
import { outbox } from "./outbox";
import { setPreview } from "./previews";
import { sessionQuery } from "./queries";
import { canEdit } from "./read-only";

/** A photo in the capture sheet, resized in the background while you type. */
export interface DraftPhoto {
  id: string;
  file: Blob;
  processed?: ProcessedPhoto;
}

interface CaptureContextValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** The unsaved note, kept when the sheet closes (and across reloads) so nothing is lost. */
  draft: string;
  setDraft: (draft: string) => void;
  photos: DraftPhoto[];
  addFiles: (files: Iterable<File>) => void;
  removePhoto: (id: string) => void;
  /** Opens the sheet with photos or text already in it (paste, drop). */
  openWith: (input: { files?: Iterable<File>; text?: string }) => void;
  /** Saves the capture to the outbox and closes the sheet at once. Returns the new id. */
  save: () => string | null;
  /** Adds the capture to an item or an attempt. Returns false when there was nothing to add. */
  saveTo: (target: Exclude<CaptureTarget, { kind: "idea" }>) => boolean;
  /** The idea saved last in this visit, so the inbox can welcome it. */
  landed: string | null;
  /** The idea or build on screen: captures go there while it shows. */
  pageItem: PageItem | null;
  setPageItem: (item: PageItem | null) => void;
}

/** What the capture sheet needs to know about the idea or build on screen. */
export interface PageItem {
  id: string;
  title: string | null;
  stage: ItemStage;
  /** Its attempt still printing, if any. */
  printing?: { attemptId: string; number: number };
}

const CaptureContext = createContext<CaptureContextValue | null>(null);
const DRAFT_KEY = "spaghetti:capture-draft";
const FIRST_KEY = "spaghetti:first-idea";

function storedDraft(): string {
  try {
    return localStorage.getItem(DRAFT_KEY) ?? "";
  } catch {
    return "";
  }
}

/** Only images; a browser may hand us other files from a drop. */
export function imageFiles(files: Iterable<File>): File[] {
  return Array.from(files).filter(
    (file) => file.type.startsWith("image/") || /\.(hei[cf]|jpe?g|png|webp)$/i.test(file.name),
  );
}

/**
 * Photos picked for something not saved yet (a capture, an attempt): shown
 * at once from the device and resized in the background while you type.
 */
export function useDraftPhotos() {
  const [photos, setPhotos] = useState<DraftPhoto[]>([]);
  const photosRef = useRef(photos);
  photosRef.current = photos;

  const addFiles = useCallback((files: Iterable<File>) => {
    const added = imageFiles(files).map((file) => ({ id: crypto.randomUUID(), file }));
    if (!added.length) return;
    for (const photo of added) setPreview(photo.id, photo.file, photo.file);
    setPhotos((current) => [...current, ...added]);
    for (const photo of added) {
      processPhoto(photo.file).then(
        (processed) => {
          setPreview(photo.id, processed.thumb, processed.large);
          setPhotos((current) => current.map((p) => (p.id === photo.id ? { ...p, processed } : p)));
        },
        (error) => {
          setPhotos((current) => current.filter((p) => p.id !== photo.id));
          toast.error(
            "Couldn't open that photo",
            error instanceof UnreadablePhotoError ? error.message : "Try another one.",
          );
        },
      );
    }
  }, []);

  const removePhoto = useCallback((id: string) => {
    setPhotos((current) => current.filter((photo) => photo.id !== id));
  }, []);

  const clear = useCallback(() => setPhotos([]), []);
  return { photos, photosRef, addFiles, removePhoto, clear };
}

/** Where a capture goes: a new idea, the item on screen, or the print running now. */
export type CaptureTarget =
  | { kind: "idea" }
  | { kind: "item"; itemId: string }
  | { kind: "attempt"; itemId: string; attemptId: string; outcome?: Outcome | null };

/** Holds the capture sheet's state, so any screen can open it. */
export function CaptureProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [draft, setDraftState] = useState(storedDraft);
  const { photos, photosRef, addFiles, removePhoto, clear: clearPhotos } = useDraftPhotos();
  // The idea or build on screen, which captures go to while it shows.
  const [pageItem, setPageItem] = useState<PageItem | null>(null);
  const [landed, setLanded] = useState<string | null>(null);
  // The welcome animation plays once, on the inbox the capture lands in.
  useEffect(() => {
    if (!landed) return;
    const timer = setTimeout(() => setLanded(null), 1500);
    return () => clearTimeout(timer);
  }, [landed]);
  const setDraft = useCallback((value: string) => {
    setDraftState(value);
    try {
      if (value) localStorage.setItem(DRAFT_KEY, value);
      else localStorage.removeItem(DRAFT_KEY);
    } catch {
      // Private mode: the draft lives in memory only.
    }
  }, []);

  const openWith = useCallback(
    ({ files, text }: { files?: Iterable<File>; text?: string }) => {
      if (files) addFiles(files);
      if (text) {
        setDraftState((current) => {
          const next = current.trim() ? `${current.trimEnd()}\n${text}` : text;
          try {
            localStorage.setItem(DRAFT_KEY, next);
          } catch {}
          return next;
        });
      }
      setOpen(true);
    },
    [addFiles],
  );

  const save = useCallback(() => {
    const note = draft.trim();
    const current = photosRef.current;
    const user = queryClient.getQueryData(sessionQuery.queryKey);
    if ((!note && !current.length) || !user) return null;

    const firstEver = isFirstIdea(queryClient.getQueryData(ideasQuery.queryKey));
    const itemId = crypto.randomUUID();
    const now = Date.now();
    void outbox.add({
      itemId,
      create: { title: null, note, createdAt: now, createdBy: user.id },
      photos: current.map((photo, position) => ({
        id: photo.id,
        position,
        // Still resizing: the outbox finishes the job from the original.
        ...(photo.processed ? { processed: photo.processed } : { file: photo.file }),
      })),
      queuedAt: now,
    });
    setDraft("");
    clearPhotos();
    setOpen(false);
    setLanded(itemId);
    if (firstEver) {
      try {
        localStorage.setItem(FIRST_KEY, "1");
      } catch {}
      toast.delight("First one in the pot", "Every print starts as an idea like this. Add more whenever they come.");
    }
    return itemId;
  }, [draft, queryClient, setDraft, photosRef, clearPhotos]);

  /**
   * Adds the capture to an item or attempt instead of making an idea: its
   * photos join it (uploading in the background), its note is added to the
   * item's notes or the attempt's line, and an outcome finishes the attempt.
   */
  const saveTo = useCallback(
    (target: Exclude<CaptureTarget, { kind: "idea" }>) => {
      const note = draft.trim();
      const current = photosRef.current;
      if (!note && !current.length && !(target.kind === "attempt" && target.outcome)) return false;
      const item = cachedItem(queryClient, target.itemId);
      const pendingAttempt =
        target.kind === "attempt" &&
        outbox
          .getSnapshot()
          .entries.flatMap((entry) => entry.attempts ?? [])
          .some((a) => a.id === target.attemptId);
      // Without a connection, a saved print can still be finished (the outbox sends it); other changes to saved things wait.
      const finishQueued = target.kind === "attempt" && !!target.outcome && !isOnline() && !pendingAttempt;
      const needsServer =
        !!note &&
        !isOnline() &&
        !finishQueued &&
        (target.kind === "attempt" ? !pendingAttempt : !outbox.isPending(target.itemId));
      // Refuse before anything is queued, so the draft stays in the sheet.
      if (needsServer && !canEdit()) return false;
      if (current.length) {
        void outbox.add({
          itemId: target.itemId,
          photos: current.map((photo) => ({
            id: photo.id,
            ...(target.kind === "attempt" ? { attemptId: target.attemptId } : {}),
            ...(photo.processed ? { processed: photo.processed } : { file: photo.file }),
          })),
          queuedAt: Date.now(),
        });
      }
      if (target.kind === "item" && note) {
        const before = item?.note.trimEnd() ?? "";
        void saveItemChanges(queryClient, target.itemId, { note: before ? `${before}\n\n${note}` : note }).catch(() =>
          toast.error("Couldn't add the note", "It's still in the capture sheet's draft."),
        );
      }
      if (target.kind === "attempt") {
        const attempt =
          item?.attempts.find((a) => a.id === target.attemptId) ??
          outbox
            .getSnapshot()
            .entries.flatMap((entry) => entry.attempts ?? [])
            .find((a) => a.id === target.attemptId);
        const before = attempt?.note.trim() ?? "";
        if (finishQueued && target.outcome && attempt) {
          queueFinish(target.itemId, attempt, {
            outcome: target.outcome,
            note: note ? (before ? `${before} ${note}` : note) : before,
            failureTags: attempt.failureTags,
            successNotes: attempt.successNotes,
          });
          setDraft("");
          clearPhotos();
          setOpen(false);
          return true;
        }
        const changes = {
          ...(note ? { note: before ? `${before} ${note}` : note } : {}),
          ...(target.outcome ? { outcome: target.outcome } : {}),
        };
        if (Object.keys(changes).length) {
          void saveAttemptChanges(queryClient, target.itemId, target.attemptId, changes).catch(() =>
            toast.error("Couldn't save that to the attempt", "Open the build and try again."),
          );
        }
      }
      setDraft("");
      clearPhotos();
      setOpen(false);
      return true;
    },
    [draft, queryClient, setDraft, photosRef, clearPhotos],
  );

  const value = useMemo(
    () => ({
      open,
      setOpen,
      draft,
      setDraft,
      photos,
      addFiles,
      removePhoto,
      openWith,
      save,
      saveTo,
      landed,
      pageItem,
      setPageItem,
    }),
    [open, draft, setDraft, photos, addFiles, removePhoto, openWith, save, saveTo, landed, pageItem],
  );
  return <CaptureContext value={value}>{children}</CaptureContext>;
}

/** The very first idea in the workspace, seen on this device only once. */
function isFirstIdea(ideas: unknown[] | undefined): boolean {
  try {
    if (localStorage.getItem(FIRST_KEY)) return false;
  } catch {
    return false;
  }
  return Array.isArray(ideas) && ideas.length === 0 && outbox.getSnapshot().entries.length === 0;
}

export function useCapture(): CaptureContextValue {
  const value = useContext(CaptureContext);
  if (!value) throw new Error("useCapture must be used inside <CaptureProvider>");
  return value;
}

/** An idea's or build's page: while it shows, capturing, pasting and dropping add to it. */
export function useCaptureHere(item: Pick<ItemView, "id" | "title" | "stage" | "attempts">) {
  const { setPageItem } = useCapture();
  const printing = item.attempts.findLast((attempt) => attempt.outcome === null);
  const { id, title, stage } = item;
  const attemptId = printing?.id;
  const number = printing?.number;
  useEffect(() => {
    setPageItem({
      id,
      title,
      stage,
      ...(attemptId && number ? { printing: { attemptId, number } } : {}),
    });
  }, [id, title, stage, attemptId, number, setPageItem]);
  useEffect(() => () => setPageItem(null), [setPageItem]);
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

/**
 * Desktop capture from anywhere: paste an image or a link, or drop photos on
 * the window. Returns whether files are being dragged over the window, for
 * the drop overlay.
 */
export function useGlobalCapture(): boolean {
  const { openWith, open } = useCapture();
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    function onPaste(event: ClipboardEvent) {
      const data = event.clipboardData;
      if (!data) return;
      const files = imageFiles(data.files);
      const inCapture = event.target instanceof HTMLElement && !!event.target.closest("[data-capture]");
      if (files.length) {
        // Images join the capture, even when pasted into its note.
        if (isTypingTarget(event.target) && !inCapture) return;
        event.preventDefault();
        openWith({ files });
        return;
      }
      // Text pasted into a field is that field's business.
      if (isTypingTarget(event.target) || open) return;
      const text = data.getData("text/plain").trim();
      if (!text) return;
      event.preventDefault();
      openWith({ text });
    }

    let depth = 0;
    const hasFiles = (event: DragEvent) => !!event.dataTransfer?.types.includes("Files");
    function onDragEnter(event: DragEvent) {
      if (!hasFiles(event)) return;
      depth += 1;
      setDragging(true);
    }
    function onDragLeave(event: DragEvent) {
      if (!hasFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    }
    function onDragOver(event: DragEvent) {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    }
    function onDrop(event: DragEvent) {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      const files = imageFiles(event.dataTransfer?.files ?? []);
      if (files.length) openWith({ files });
      else toast.message("Only photos can be dropped here", "Drop JPEG, PNG or WebP images to capture them.");
    }

    window.addEventListener("paste", onPaste);
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, [openWith, open]);

  return dragging;
}
