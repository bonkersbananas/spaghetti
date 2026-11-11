import { useEffect, useState } from "react";
import { Toaster as SonnerToaster, toast as sonnerToast } from "sonner";
import { useIsDesktop } from "@/lib/use-media-query";
import { CheckCircleIcon, SparkleIcon, WarningIcon } from "./icons";

/** True while a sheet or dialog is in the page. */
function useDialogOpen() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const check = () => setOpen(!!document.querySelector("[role=dialog]"));
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    check();
    return () => observer.disconnect();
  }, []);
  return open;
}

/**
 * Mount once, at the root. Phones: above the tab bar, but at the top while a sheet is open (a bottom sheet would
 * cover them, or they would cover its buttons). Desktop: bottom right. Toasts sit above sheets (app.css) and take
 * presses without closing the sheet (Sheet.tsx ignores presses on them).
 */
export function Toaster() {
  const isDesktop = useIsDesktop();
  const overSheet = useDialogOpen() && !isDesktop;
  return (
    <SonnerToaster
      position={isDesktop ? "bottom-right" : overSheet ? "top-center" : "bottom-center"}
      offset={isDesktop ? 24 : undefined}
      // --sg-actionbar-offset is set while a screen shows its ActionBar, so toasts never cover it.
      mobileOffset={{
        bottom: "calc(var(--sg-tabbar-height) + var(--sg-actionbar-offset, 0rem) + 0.75rem)",
        top: "calc(var(--sg-safe-top, 0px) + 0.75rem)",
      }}
      gap={8}
      icons={{
        success: <CheckCircleIcon size={18} weight="fill" />,
        error: <WarningIcon size={18} weight="fill" />,
      }}
    />
  );
}

interface UndoOptions {
  /** Runs when the person taps Undo. Restore what was removed here. */
  onUndo: () => void;
  description?: string;
  /** How long Undo stays available. Long enough to notice a slip. */
  duration?: number;
}

/**
 * Toasts. Deletes never ask "are you sure?": do the delete optimistically and
 * call `toast.undo("Idea deleted", { onUndo })` so it can be taken back.
 */
export const toast = {
  message: (message: string, description?: string) => sonnerToast(message, { description }),
  success: (message: string, description?: string) => sonnerToast.success(message, { description }),
  error: (message: string, description?: string) => sonnerToast.error(message, { description }),
  /**
   * One of the rare moments of delight, such as the very first idea or a
   * build finished after some spaghetti. It can carry one action (Undo).
   */
  delight: (message: string, description?: string, action?: { label: string; onClick: () => void }) =>
    sonnerToast(message, {
      description,
      action,
      icon: <SparkleIcon size={18} weight="fill" />,
      duration: action ? 7000 : 5000,
      className: "sg-delight",
    }),
  /** A toast with one action, such as "View" after saving from another screen. */
  action: (message: string, action: { label: string; onClick: () => void }, description?: string) =>
    sonnerToast(message, { description, action }),
  /**
   * A quiet offer that stays until answered: the words on a full-width line, one action and "Not now" in a row
   * beneath (the person's choice; the caller never repeats it).
   */
  offer: (message: string, description: string, action: { label: string; onClick: () => void }) =>
    sonnerToast.custom(
      (id) => (
        <div role="status" className="bg-toast text-toast-fg shadow-float w-full rounded-md p-4">
          <p className="text-body font-semibold">{message}</p>
          <p className="text-small mt-0.5 opacity-70">{description}</p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="pressable focus-ring touch-target bg-toast-fg text-toast text-small relative h-9 rounded-sm px-4 font-semibold"
              onClick={() => {
                sonnerToast.dismiss(id);
                action.onClick();
              }}
            >
              {action.label}
            </button>
            <button
              type="button"
              className="pressable focus-ring touch-target hover:bg-toast-fg/15 text-small relative h-9 rounded-sm px-4 font-semibold"
              onClick={() => sonnerToast.dismiss(id)}
            >
              Not now
            </button>
          </div>
        </div>
      ),
      { duration: Number.POSITIVE_INFINITY, dismissible: true },
    ),
  /** A new version of the app is installed and waiting: stays until it is taken or dismissed. */
  update: (onRefresh: () => void) =>
    sonnerToast("A new version is ready", {
      id: "app-update",
      description: "Refresh to get it. Nothing you captured is lost.",
      duration: Number.POSITIVE_INFINITY,
      dismissible: true,
      action: { label: "Refresh", onClick: onRefresh },
    }),
  undo: (message: string, { onUndo, description, duration = 6000 }: UndoOptions) =>
    sonnerToast(message, {
      description,
      duration,
      action: { label: "Undo", onClick: onUndo },
    }),
};
