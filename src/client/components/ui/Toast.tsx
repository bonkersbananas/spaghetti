import { Toaster as SonnerToaster, toast as sonnerToast } from "sonner";
import { useIsDesktop } from "@/lib/use-media-query";
import { CheckCircleIcon, SparkleIcon, WarningIcon } from "./icons";

/** Mount once, at the root. Phones: above the tab bar. Desktop: bottom right. */
export function Toaster() {
  const isDesktop = useIsDesktop();
  return (
    <SonnerToaster
      position={isDesktop ? "bottom-right" : "bottom-center"}
      offset={isDesktop ? 24 : undefined}
      mobileOffset={{ bottom: "calc(var(--sg-tabbar-height) + var(--sg-safe-bottom) + 0.75rem)" }}
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
  /** One of the rare moments of delight, such as the very first idea. */
  delight: (message: string, description?: string) =>
    sonnerToast(message, { description, icon: <SparkleIcon size={18} weight="fill" />, duration: 5000 }),
  /** A toast with one action, such as "View" after saving from another screen. */
  action: (message: string, action: { label: string; onClick: () => void }, description?: string) =>
    sonnerToast(message, { description, action }),
  undo: (message: string, { onUndo, description, duration = 6000 }: UndoOptions) =>
    sonnerToast(message, {
      description,
      duration,
      action: { label: "Undo", onClick: onUndo },
    }),
};
