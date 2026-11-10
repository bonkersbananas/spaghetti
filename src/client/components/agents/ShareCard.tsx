import { bookmarklet } from "@shared/shortcut";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { CheckIcon, CopyIcon, ShareIcon } from "@/components/ui/icons";
import { canEdit, useReadOnly } from "@/lib/read-only";
import { useIsDesktop } from "@/lib/use-media-query";
import { ShareSetupSheet } from "./ShareSetupSheet";

/** The bookmark to drag to the bookmarks bar. React won't render a `javascript:` href, so it is set on the element. */
function BookmarkletLink() {
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => ref.current?.setAttribute("href", bookmarklet(window.location.origin)), []);
  return (
    // biome-ignore lint/a11y/useValidAnchor: the href is a bookmarklet, set once mounted.
    <a
      ref={ref}
      href="#save-to-spaghetti"
      onClick={(event) => event.preventDefault()}
      draggable
      className="pressable focus-ring bg-lifted text-ink shadow-soft text-small inline-flex min-h-9 cursor-grab items-center rounded-md px-3.5 font-semibold active:cursor-grabbing"
    >
      Save to Spaghetti
    </a>
  );
}

/**
 * Ways to get things in from other places: the installed app is already in Android's and Chrome's share sheet,
 * iPhone needs a Shortcut (made here with its own capture-only key), and desktop browsers get a bookmarklet.
 */
export function ShareCard() {
  const readOnly = useReadOnly();
  const isDesktop = useIsDesktop();
  const [setup, setSetup] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <section
      aria-labelledby="share-heading"
      className="bg-cream shadow-soft mb-6 flex max-w-2xl flex-col gap-4 rounded-lg p-5"
    >
      <div className="flex items-start gap-3.5">
        <span
          className="bg-ink/6 text-ink-soft flex size-11 shrink-0 items-center justify-center rounded-full"
          aria-hidden
        >
          <ShareIcon size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="share-heading" className="text-lead text-ink font-semibold">
            Share to Spaghetti
          </h2>
          <p className="text-small text-ink-faint">
            A link, a photo or a thought, one tap from wherever it turns up. On Android and in Chrome, the installed app
            is already in the share sheet.
          </p>
        </div>
      </div>
      <div className="border-ink/6 flex flex-col gap-2.5 border-t pt-4">
        <h3 className="text-small text-ink-soft font-sans font-semibold">iPhone</h3>
        <p className="text-small text-ink-faint">
          Safari can't share to web apps, so a Shortcut does it. Setting up makes a key that can only add ideas.
        </p>
        <Button
          variant="secondary"
          className="self-start"
          disabled={readOnly}
          onClick={() => canEdit() && setSetup(true)}
        >
          Set up sharing from iPhone
        </Button>
      </div>
      {isDesktop && (
        <div className="border-ink/6 flex flex-col gap-2.5 border-t pt-4">
          <h3 className="text-small text-ink-soft font-sans font-semibold">Desktop browsers</h3>
          <p className="text-small text-ink-faint">
            Drag this to your bookmarks bar. On any page, it opens a small window with the page's title, address and
            what you selected, already saved.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <BookmarkletLink />
            <Button
              variant="quiet"
              size="sm"
              icon={copied ? CheckIcon : CopyIcon}
              aria-live="polite"
              onClick={async () => {
                await navigator.clipboard.writeText(bookmarklet(window.location.origin)).catch(() => undefined);
                setCopied(true);
              }}
            >
              {copied ? "Copied" : "Copy bookmarklet"}
            </Button>
          </div>
        </div>
      )}
      <ShareSetupSheet open={setup} onOpenChange={setSetup} />
    </section>
  );
}
