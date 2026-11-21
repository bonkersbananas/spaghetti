import { dateFormat } from "@shared/date-format";
import type { ShareKind } from "@shared/shares";
import { useQueryClient } from "@tanstack/react-query";
import { type RefObject, useState } from "react";
import { PopoverAnchor, PopoverPanel, PopoverRoot } from "@/components/ui/Popover";
import { ShareChoices } from "@/components/ui/ShareChoices";
import { Sheet } from "@/components/ui/Sheet";
import { useReadOnly } from "@/lib/read-only";
import { useShareOf } from "@/lib/share-query";
import { copyLink, makePublic, privateUrl, publicUrl, shareLink, stopSharing } from "@/lib/shares";
import { useIsDesktop } from "@/lib/use-media-query";

interface SharePanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: ShareKind;
  targetId: string;
  /** The thing's title, for the share sheet and the panel's name. */
  title: string;
  /** "idea", "build", "twist": what the words call it. */
  what: string;
  /** The share button: the popover hangs from it, and focus goes back to it. */
  anchor: RefObject<HTMLButtonElement | null>;
}

const since = (time: number) => `Since ${dateFormat({ day: "numeric", month: "short" }).format(time)}`;

/**
 * The share button's panel (lazy, decision 0075): a popover under the button on desktop, a sheet on phones, with the
 * private link and the public one. Phones send either through the system share sheet once it is there to send.
 */
export default function SharePanel({ open, onOpenChange, kind, targetId, title, what, anchor }: SharePanelProps) {
  const isDesktop = useIsDesktop();
  const queryClient = useQueryClient();
  const share = useShareOf(kind, targetId);
  const readOnly = useReadOnly();
  const [making, setMaking] = useState(false);
  const canShare = !isDesktop && typeof navigator !== "undefined" && typeof navigator.share === "function";
  const name = title || `This ${what}`;

  const choices = (
    <ShareChoices
      state={share ? "on" : making ? "making" : "off"}
      publicUrl={share ? publicUrl(share.token) : undefined}
      since={share ? since(share.createdAt) : undefined}
      canShare={canShare}
      readOnly={readOnly}
      onPrivate={() =>
        void (canShare
          ? shareLink(privateUrl(), name, "Only the two of you can open it.")
          : copyLink(privateUrl(), "Only the two of you can open it."))
      }
      onMake={() => {
        if (making) return;
        setMaking(true);
        void makePublic(queryClient, kind, targetId).then(async (made) => {
          setMaking(false);
          // On a computer the new link is copied at once; a phone shows it with Share, for a fresh tap.
          if (made && !canShare) await copyLink(publicUrl(made.token), "Anyone with it can look at this page.");
        });
      }}
      onPublic={() => {
        if (!share) return;
        const url = publicUrl(share.token);
        void (canShare
          ? shareLink(url, name, "Anyone with it can look at this page.")
          : copyLink(url, "Anyone with it can look at this page."));
      }}
      onStop={() => {
        if (share) stopSharing(queryClient, share);
      }}
    />
  );

  if (!isDesktop) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange} title={`Share ${what}`} description={title || undefined}>
        {choices}
      </Sheet>
    );
  }
  return (
    <PopoverRoot open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor virtualRef={anchor as RefObject<HTMLButtonElement>} />
      <PopoverPanel
        label={`Share ${what}`}
        side="bottom"
        align="end"
        size="panel"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          anchor.current?.focus({ preventScroll: true });
        }}
      >
        {choices}
      </PopoverPanel>
    </PopoverRoot>
  );
}
