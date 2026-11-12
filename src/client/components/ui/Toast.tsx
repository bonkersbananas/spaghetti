import { lazy, Suspense, useState } from "react";
import { useWhenIdle } from "@/lib/when-idle";
import { SparkleIcon } from "./icons";

type Sonner = typeof import("sonner");

/**
 * Toasts load sonner (and its Toaster, ToastHost.tsx) once the app is idle, or at the first toast. A toast asked for
 * before then waits for the Toaster to be mounted (a few ms from the service worker's cache), because sonner forgets
 * toasts made while no Toaster is listening.
 */
const ToastHost = lazy(() => import("./ToastHost"));
let sonner: Promise<Sonner> | undefined;
const loadSonner = () => {
  sonner ??= import("sonner");
  return sonner;
};
let wantHost = () => {};
let toasterReady: () => void = () => {};
const ready = new Promise<void>((resolve) => {
  toasterReady = resolve;
});

/** Mount once, at the root. */
export function Toaster() {
  const [wanted, setWanted] = useState(false);
  wantHost = () => setWanted(true);
  useWhenIdle(() => setWanted(true));
  return wanted ? (
    <Suspense fallback={null}>
      <ToastHost onReady={toasterReady} />
    </Suspense>
  ) : null;
}

/** Runs `show` with sonner's toast as soon as the Toaster is there. */
function show(run: (toast: Sonner["toast"]) => void) {
  wantHost();
  void Promise.all([loadSonner(), ready]).then(([module]) => run(module.toast));
}

interface UndoOptions {
  /** Runs when the person taps Undo. Restore what was removed here. */
  onUndo: () => void;
  description?: string;
  /** How long Undo stays available. Long enough to notice a slip. */
  duration?: number;
  /** Lets the next step put this one away (`toast.dismiss(id)`), such as a draft's undo once its idea is built. */
  id?: string;
}

/**
 * Toasts. Deletes never ask "are you sure?": do the delete optimistically and
 * call `toast.undo("Idea deleted", { onUndo })` so it can be taken back.
 */
/** The update toast's words when there is no note about what changed. */
const UPDATE_TEXT = "Refresh to get it. Nothing you captured is lost.";

export const toast = {
  message: (message: string, description?: string) => show((t) => t(message, { description })),
  success: (message: string, description?: string) => show((t) => t.success(message, { description })),
  error: (message: string, description?: string) => show((t) => t.error(message, { description })),
  /**
   * One of the rare moments of delight, such as the very first idea or a
   * build finished after some spaghetti. It can carry one action (Undo).
   */
  delight: (message: string, description?: string, action?: { label: string; onClick: () => void }) =>
    show((t) =>
      t(message, {
        description,
        action,
        icon: <SparkleIcon size={18} weight="fill" />,
        duration: action ? 7000 : 5000,
        className: "sg-delight",
      }),
    ),
  /** A toast with one action, such as "View" after saving from another screen. */
  action: (message: string, action: { label: string; onClick: () => void }, description?: string) =>
    show((t) => t(message, { description, action })),
  /**
   * A quiet offer that stays until answered: the words on a full-width line, one action and "Not now" in a row
   * beneath (the person's choice; the caller never repeats it).
   */
  offer: (message: string, description: string, action: { label: string; onClick: () => void }) =>
    show((t) =>
      t.custom(
        (id) => (
          <div role="status" className="bg-toast text-toast-fg shadow-float w-full rounded-md p-4">
            <p className="text-body font-semibold">{message}</p>
            <p className="text-small mt-0.5 opacity-70">{description}</p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className="pressable focus-ring touch-target bg-toast-fg text-toast text-small relative h-9 rounded-sm px-4 font-semibold"
                onClick={() => {
                  t.dismiss(id);
                  action.onClick();
                }}
              >
                {action.label}
              </button>
              <button
                type="button"
                className="pressable focus-ring touch-target hover:bg-toast-fg/15 text-small relative h-9 rounded-sm px-4 font-semibold"
                onClick={() => t.dismiss(id)}
              >
                Not now
              </button>
            </div>
          </div>
        ),
        { duration: Number.POSITIVE_INFINITY, dismissible: true },
      ),
    ),
  /**
   * A new version of the app is installed and waiting: stays until it is taken or dismissed. `sentence` says what
   * changed (lib/whats-new.ts); calling this again with the same id swaps the words in place.
   */
  update: (onRefresh: () => void, sentence?: string) =>
    show((t) =>
      t("A new version is ready", {
        id: "app-update",
        description: sentence ?? UPDATE_TEXT,
        duration: Number.POSITIVE_INFINITY,
        dismissible: true,
        action: { label: "Refresh", onClick: onRefresh },
      }),
    ),
  undo: (message: string, { onUndo, description, duration = 6000, id }: UndoOptions) =>
    show((t) =>
      t(message, {
        id,
        description,
        duration,
        action: { label: "Undo", onClick: onUndo },
      }),
    ),
  /** Puts one toast away. Before sonner has loaded there is nothing to put away, so this never loads it. */
  dismiss: (id: string) => void sonner?.then((module) => module.toast.dismiss(id)),
};
