import type { ShareKind } from "@shared/shares";
import { forwardRef, lazy, Suspense, useRef, useState } from "react";
import { IconButton } from "@/components/ui/Button";
import { type Icon, type IconProps, PublicIcon, ShareIcon } from "@/components/ui/icons";
import { useShareOf } from "@/lib/share-query";

const SharePanel = lazy(() => import("@/components/share/SharePanel"));

/** The globe the button shows while a public link is live: basil, filled, so "shared" reads at a glance. */
const SharedIcon = forwardRef<SVGSVGElement, IconProps>(function SharedIcon(props, ref) {
  return <PublicIcon ref={ref} {...props} weight="fill" className="text-basil-ink" />;
}) as Icon;

interface ShareLinkButtonProps {
  kind: ShareKind;
  id: string;
  title?: string;
  /** "idea", "build", "twist". */
  what: string;
}

/**
 * The share button in a detail page's bar (idea, build, twist), always the same place: before the delete button. It
 * opens the ways to share (decision 0075): the private link, for the two people, and a public one anyone with the
 * link can look at. While a public link is live the button is a basil globe, so the page says it is shared.
 */
export function ShareLinkButton({ kind, id, title, what }: ShareLinkButtonProps) {
  const share = useShareOf(kind, id);
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  // The panel's code arrives with the first tap (or a hover that hints at one), and stays.
  const [asked, setAsked] = useState(false);
  const label = share ? `Share ${what} (anyone with the link can look)` : `Share ${what}`;
  return (
    <>
      <IconButton
        ref={button}
        icon={share ? SharedIcon : ShareIcon}
        label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onPointerEnter={() => setAsked(true)}
        onClick={() => {
          setAsked(true);
          setOpen((was) => !was);
        }}
      />
      {asked && (
        <Suspense fallback={null}>
          <SharePanel
            open={open}
            onOpenChange={setOpen}
            kind={kind}
            targetId={id}
            title={title ?? ""}
            what={what}
            anchor={button}
          />
        </Suspense>
      )}
    </>
  );
}
