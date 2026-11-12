import * as Dialog from "@radix-ui/react-dialog";
import { type ReactNode, useRef } from "react";
import { Drawer } from "vaul";
import { cn } from "@/lib/cn";
import { useReturnFocus } from "@/lib/return-focus";
import { useIsDesktop } from "@/lib/use-media-query";
import { IconButton } from "./Button";
import { CloseIcon } from "./icons";

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  /** Sticky actions at the bottom (phone) or footer (desktop). */
  footer?: ReactNode;
  /** Small buttons at the right of the header, beside the title (stepping between things): next to the close button on desktop. */
  headerActions?: ReactNode;
  /**
   * How it appears on desktop: a centered "dialog" for quick, focused tasks
   * (capture), or a "panel" sliding in from the right for detail views.
   * On phones it is always a bottom sheet.
   */
  desktop?: "dialog" | "panel";
  /** A wider desktop dialog, for content that sits in columns (the shortcut list). */
  wide?: boolean;
  /** On phones, as tall as a sheet gets instead of as tall as its content (the compare sheet's two attempts). */
  tall?: boolean;
  /** The body fills the sheet edge to edge, with no padding or scrolling, for content that draws itself (the 3D view). Taller, and wider on desktop. */
  fill?: boolean;
  children: ReactNode;
}

/** A press on a toast (Undo) isn't "outside" the sheet: it must not close it. */
const keepOpenForToast = (event: { target: EventTarget | null; preventDefault: () => void }) => {
  if (event.target instanceof Element && event.target.closest("[data-sonner-toaster]")) event.preventDefault();
};

/** What can take focus first in a sheet's body (disabled and hidden controls left out). */
const FOCUSABLE =
  "input:not([type=hidden]):not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])";

/**
 * The one overlay. Bottom sheet on phones (drag down to dismiss, thumb-reach
 * actions), dialog or side panel on desktop. Never an "are you sure?" box:
 * deletes use an undo toast instead.
 */
export function Sheet(props: SheetProps) {
  const isDesktop = useIsDesktop();
  return isDesktop ? <DesktopSheet {...props} /> : <PhoneSheet {...props} />;
}

function PhoneSheet({
  open,
  onOpenChange,
  title,
  description,
  footer,
  headerActions,
  tall,
  fill,
  children,
}: SheetProps) {
  const returnFocus = useReturnFocus(open);
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} repositionInputs={false}>
      <Drawer.Portal>
        <Drawer.Overlay className="bg-scrim fixed inset-0 z-40" />
        <Drawer.Content
          // vaul leaves focus on what opened the sheet (so no field grabs it and pops the keyboard up):
          // move it to the sheet itself, so Tab starts inside and stays there. A field that asked for focus keeps it.
          onOpenAutoFocus={(event) => {
            const sheet = event.currentTarget;
            if (!(sheet instanceof HTMLElement)) return;
            requestAnimationFrame(() => {
              if (!sheet.contains(document.activeElement)) sheet.focus({ preventScroll: true });
            });
          }}
          onCloseAutoFocus={returnFocus}
          onInteractOutside={keepOpenForToast}
          // Sits on the keyboard when it is up (lib/viewport.ts), so the footer's button stays in view.
          className={cn(
            "bg-lifted shadow-float fixed inset-x-0 bottom-[var(--sg-keyboard-inset)] z-50 flex flex-col rounded-t-xl focus:outline-none",
            tall || fill
              ? "h-[min(92dvh,calc(var(--sg-visible-height)-var(--sg-safe-top)-0.75rem))]"
              : "max-h-[min(92dvh,calc(var(--sg-visible-height)-var(--sg-safe-top)-0.75rem))]",
          )}
        >
          <div className="rounded-pill bg-ink/15 mx-auto mt-2.5 mb-1 h-1.5 w-10 shrink-0" aria-hidden />
          <div className="flex items-start justify-between gap-3 px-5 pt-2 pb-1">
            <div className="min-w-0">
              <Drawer.Title className="font-display text-title text-ink line-clamp-2 font-semibold break-words">
                {title}
              </Drawer.Title>
              {description ? (
                <Drawer.Description className="text-small text-ink-faint mt-0.5">{description}</Drawer.Description>
              ) : (
                <Drawer.Description className="sr-only">{title}</Drawer.Description>
              )}
            </div>
            {headerActions && <div className="-mr-2 flex shrink-0 items-center gap-1">{headerActions}</div>}
          </div>
          {fill ? (
            <div className="min-h-0 flex-1 overflow-hidden pt-2">{children}</div>
          ) : (
            <div className="scroll-fade min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-3 pb-4">
              {children}
            </div>
          )}
          {footer && (
            <div className="flex shrink-0 items-center gap-3 px-5 pt-2 pb-[max(1rem,var(--sg-safe-bottom))]">
              {footer}
            </div>
          )}
          {!footer && <div className="pb-safe" />}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

function DesktopSheet({
  open,
  onOpenChange,
  title,
  description,
  footer,
  headerActions,
  desktop = "dialog",
  wide,
  fill,
  children,
}: SheetProps) {
  const isPanel = desktop === "panel";
  const returnFocus = useReturnFocus(open);
  const body = useRef<HTMLDivElement>(null);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="sg-overlay bg-scrim fixed inset-0 z-40" />
        <Dialog.Content
          // Keyboard use starts where the task does: the first control in the body (the note to write, the outcome
          // to pick), not the header's arrows or Close. Something in the body that took focus itself keeps it.
          onOpenAutoFocus={(event) => {
            const content = body.current;
            if (!content) return;
            if (content.contains(document.activeElement)) return event.preventDefault();
            // The first one that is drawn: hidden file inputs and collapsed controls can't take focus.
            const first = [...content.querySelectorAll<HTMLElement>(FOCUSABLE)].find(
              (element) => element.getClientRects().length > 0,
            );
            if (!first) return;
            event.preventDefault();
            first.focus({ preventScroll: true });
          }}
          onCloseAutoFocus={returnFocus}
          onInteractOutside={keepOpenForToast}
          className={cn(
            "bg-lifted shadow-float fixed z-50 flex flex-col focus:outline-none",
            isPanel
              ? "sg-panel inset-y-3 right-3 w-full max-w-md rounded-xl"
              : cn(
                  "sg-dialog left-1/2 w-full -translate-x-1/2 rounded-xl",
                  fill
                    ? "top-[3vh] h-[94vh] max-w-7xl overflow-hidden"
                    : wide
                      ? "top-[8vh] max-h-[84vh] max-w-4xl"
                      : "top-[14vh] max-h-[72vh] max-w-xl",
                ),
          )}
        >
          <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-1">
            <div>
              <Dialog.Title className="font-display text-title text-ink line-clamp-2 font-semibold break-words">
                {title}
              </Dialog.Title>
              {description ? (
                <Dialog.Description className="text-small text-ink-faint mt-0.5">{description}</Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">{title}</Dialog.Description>
              )}
            </div>
            <div className="-mt-0.5 -mr-2 flex shrink-0 items-center gap-0.5">
              {headerActions}
              <Dialog.Close asChild>
                <IconButton icon={CloseIcon} label="Close" size="sm" />
              </Dialog.Close>
            </div>
          </div>
          <div
            ref={body}
            className={
              fill
                ? "min-h-0 flex-1 overflow-hidden pt-3"
                : "scroll-fade min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pt-3 pb-5"
            }
          >
            {children}
          </div>
          {footer && (
            <div className="bg-paper/60 flex shrink-0 items-center gap-3 rounded-b-xl px-6 py-3.5">{footer}</div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
