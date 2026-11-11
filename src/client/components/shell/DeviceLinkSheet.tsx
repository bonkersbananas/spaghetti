import type { NewSignInLink, SignInLinkInfo } from "@shared/signing-in";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { CodeDisplay } from "@/components/ui/CodeDisplay";
import { CheckCircleIcon, CopyIcon, ShareIcon } from "@/components/ui/icons";
import { QrCard } from "@/components/ui/QrCard";
import { Sheet } from "@/components/ui/Sheet";
import { api } from "@/lib/api";
import { useIsDesktop } from "@/lib/use-media-query";

/**
 * "Sign in on another device": a single-use link good for ten minutes. On a laptop it is a QR code to scan with
 * the phone's camera and a short code to type; on a phone it is a link to send (and the code to read out). When
 * the other device uses it, this sheet says so ("Signed in on iPhone"): it asks the server every few seconds,
 * and the change feed refreshes it at once.
 */
export function DeviceLinkSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const isDesktop = useIsDesktop();
  const [link, setLink] = useState<NewSignInLink | null>(null);
  const make = useMutation({
    mutationFn: () => api<NewSignInLink>("/account/sign-in-links", { method: "POST" }),
    onSuccess: setLink,
  });

  // A fresh link each time the sheet opens; one that is closed unused is withdrawn.
  const started = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the sheet opening or closing starts or ends a link
  useEffect(() => {
    if (open) {
      // Once per opening: React's double effect in development must not make two (the second replaces the first).
      if (started.current) return;
      started.current = true;
      make.mutate();
    } else {
      started.current = false;
      if (!link) return;
      void api(`/account/sign-in-links/${link.id}`, { method: "DELETE" }).catch(() => undefined);
      setLink(null);
      make.reset();
      queryClient.removeQueries({ queryKey: ["sign-in-links"] });
    }
  }, [open]);

  const status = useQuery({
    queryKey: ["sign-in-links", link?.id],
    enabled: open && !!link,
    refetchInterval: (query) => (query.state.data?.usedAt ? false : 3000),
    queryFn: () => api<SignInLinkInfo>(`/account/sign-in-links/${link?.id}`),
  });
  const used = status.data?.usedAt ? (status.data.usedOn ?? "another device") : null;
  const expired = !used && link && Date.now() > link.expiresAt;
  const [copied, setCopied] = useState(false);

  async function share() {
    if (!link) return;
    try {
      await navigator.share({ title: "Sign in to Spaghetti", url: link.url });
    } catch {
      // Closed the share sheet: nothing to do.
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Sign in on another device"
      description={
        used
          ? undefined
          : isDesktop
            ? "Scan this with the phone's camera, or type the code. Good once, for ten minutes."
            : "Send this link to the other device, or read out the code. Good once, for ten minutes."
      }
      footer={
        used || expired ? (
          <Button variant="primary" fullWidth onClick={used ? () => onOpenChange(false) : () => make.mutate()}>
            {used ? "Done" : "Make a new one"}
          </Button>
        ) : !isDesktop && link ? (
          <>
            <Button
              variant={"share" in navigator ? "secondary" : "primary"}
              fullWidth={!("share" in navigator)}
              icon={copied ? CheckCircleIcon : CopyIcon}
              onClick={() => {
                void navigator.clipboard?.writeText(link.url).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1800);
                });
              }}
            >
              {copied ? "Copied" : "Copy link"}
            </Button>
            {"share" in navigator && (
              <Button variant="primary" icon={ShareIcon} fullWidth onClick={share}>
                Share link
              </Button>
            )}
          </>
        ) : undefined
      }
    >
      {used ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center" role="status">
          <CheckCircleIcon size={44} weight="fill" className="text-basil-ink" aria-hidden />
          <p className="text-lead text-ink font-semibold">Signed in on {used}</p>
          <p className="text-body text-ink-soft">It will offer to add a passkey there. This link is used up.</p>
        </div>
      ) : expired ? (
        <p className="text-body text-ink-soft py-6 text-center">That one expired. Make a new one.</p>
      ) : !link ? (
        <div className="flex flex-col items-center gap-4 py-2" aria-busy>
          {isDesktop && <div className="bg-paper-deep aspect-square w-full max-w-60 animate-pulse rounded-lg" />}
          <div className="bg-paper-deep h-8 w-48 animate-pulse rounded-md" />
        </div>
      ) : (
        <div className="flex flex-col items-center gap-5">
          {isDesktop && <QrCard value={link.url} label="QR code that signs in on another device" />}
          <CodeDisplay code={link.code} />
          {isDesktop && (
            <p className="text-small text-ink-faint text-center">
              No camera? On the sign-in screen, choose "Use a code" and type it in.
            </p>
          )}
        </div>
      )}
    </Sheet>
  );
}
