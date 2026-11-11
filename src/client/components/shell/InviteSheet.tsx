import type { InviteInfo, NewInvite } from "@shared/signing-in";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button, IconButton } from "@/components/ui/Button";
import { InfoRow } from "@/components/ui/InfoRow";
import { CheckIcon, CopyIcon, InviteIcon, ShareIcon, TrashIcon } from "@/components/ui/icons";
import { Overline } from "@/components/ui/Overline";
import { Sheet } from "@/components/ui/Sheet";
import { toast } from "@/components/ui/Toast";
import { api } from "@/lib/api";
import { invitesQuery } from "@/lib/passkey-lists";
import { peopleQuery } from "@/lib/queries";
import { useIsDesktop } from "@/lib/use-media-query";

const daysLeft = (time: number) => {
  const days = Math.ceil((time - Date.now()) / 86_400_000);
  return days <= 1 ? "expires today" : `expires in ${days} days`;
};

/**
 * "Invite someone": a single-use link good for a week. It is shown once, when it is made (only its hash is kept);
 * the invites still waiting are listed below, and either person can withdraw one.
 */
export function InviteSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const invites = useQuery({ ...invitesQuery, enabled: open });
  const people = useQuery({ ...peopleQuery, enabled: open });
  const [fresh, setFresh] = useState<NewInvite | null>(null);
  const [copied, setCopied] = useState(false);
  // On a phone the share sheet is the way to send it (Messages, AirDrop); Copy is the fallback and the desktop way.
  const canShare = !useIsDesktop() && typeof navigator !== "undefined" && "share" in navigator;

  const make = useMutation({
    mutationFn: () => api<NewInvite>("/account/invites", { method: "POST" }),
    onSuccess: (invite) => {
      setFresh(invite);
      void queryClient.invalidateQueries({ queryKey: invitesQuery.queryKey });
    },
    onError: () => toast.error("Couldn't make an invite", "Try again in a moment."),
  });

  const withdraw = useMutation({
    mutationFn: (invite: InviteInfo) => api(`/account/invites/${invite.id}`, { method: "DELETE" }),
    onMutate: async (invite) => {
      if (fresh?.id === invite.id) setFresh(null);
      queryClient.setQueryData<InviteInfo[]>(invitesQuery.queryKey, (list) => list?.filter((i) => i.id !== invite.id));
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: invitesQuery.queryKey }),
  });

  const waiting = invites.data ?? [];
  const others = waiting.filter((invite) => invite.id !== fresh?.id);
  const who = (id: string) => people.data?.find((p) => p.id === id)?.name ?? "Someone";

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setFresh(null);
          setCopied(false);
        }
        onOpenChange(next);
      }}
      title="Invite someone"
      description="A link that adds one person to the kitchen. Good once, for a week."
      footer={
        <Button variant="primary" icon={InviteIcon} fullWidth loading={make.isPending} onClick={() => make.mutate()}>
          {fresh || waiting.length ? "Make another invite" : "Make an invite link"}
        </Button>
      }
    >
      {fresh && (
        <div className="bg-paper mb-4 rounded-lg p-4">
          <p className="text-small text-ink-faint mb-2 font-semibold">Your invite link</p>
          <p className="text-small text-ink-soft font-mono break-all select-all">{fresh.url}</p>
          <p className="text-small text-ink-faint mt-2">
            Shown once. Send it to them; they pick a name and how to sign in.
          </p>
          <div className="mt-3 flex flex-col gap-2">
            {canShare && (
              <Button
                variant="primary"
                icon={ShareIcon}
                fullWidth
                onClick={() =>
                  void navigator.share({ title: "Join me on Spaghetti", url: fresh.url }).catch(() => undefined)
                }
              >
                Share invite
              </Button>
            )}
            <Button
              variant={canShare ? "quiet" : "secondary"}
              size="sm"
              icon={copied ? CheckIcon : CopyIcon}
              className={canShare ? "self-center" : "self-start"}
              onClick={() => {
                void navigator.clipboard?.writeText(fresh.url).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1800);
                });
              }}
            >
              {copied ? "Copied" : "Copy link"}
            </Button>
          </div>
        </div>
      )}
      {others.length > 0 ? (
        <>
          <Overline as="h3" className="mb-1 block">
            Waiting
          </Overline>
          <ul>
            {others.map((invite) => (
              <InfoRow
                key={invite.id}
                icon={InviteIcon}
                title="Invite for one person"
                meta={`Made by ${who(invite.createdBy)} · ${daysLeft(invite.expiresAt)}`}
                actions={
                  <IconButton icon={TrashIcon} label="Withdraw invite" onClick={() => withdraw.mutate(invite)} />
                }
              />
            ))}
          </ul>
        </>
      ) : (
        !fresh && (
          <p className="text-body text-ink-soft">
            No invites waiting. This is still a private notebook: only someone you invite can join.
          </p>
        )
      )}
    </Sheet>
  );
}
