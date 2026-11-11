import type { PasskeyInfo } from "@shared/signing-in";
import { inlineTime, relativeTime } from "@shared/time";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { Button, IconButton } from "@/components/ui/Button";
import { InfoRow } from "@/components/ui/InfoRow";
import { PasskeyIcon, PhoneIcon, RenameIcon, TrashIcon } from "@/components/ui/icons";
import { Sheet } from "@/components/ui/Sheet";
import { RowSkeleton } from "@/components/ui/Skeleton";
import { toast } from "@/components/ui/Toast";
import { passkeysQuery, removePasskey, renamePasskey } from "@/lib/passkey-lists";
import { addPasskeyHere, biometric, isCancelled } from "@/lib/passkeys";

/** Your passkeys: one per device, with when it was added and last used; add this device's, rename, remove (with Undo). */
export function PasskeysSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const list = useQuery({ ...passkeysQuery, enabled: open });
  const [renaming, setRenaming] = useState<string | null>(null);
  const word = biometric();

  const add = useMutation({
    mutationFn: addPasskeyHere,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: passkeysQuery.queryKey });
      toast.success(word === "a passkey" ? "Passkey added" : `${word} is set up`, "You can sign in with it next time.");
    },
    onError: (error) => {
      if (!isCancelled(error)) toast.error("Couldn't add that passkey", "Nothing was changed. Try again in a moment.");
    },
  });

  const passkeys = list.data ?? [];
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Passkeys"
      description={`Sign in with ${word === "a passkey" ? "a passkey" : word} instead of a password.`}
      footer={
        <Button variant="primary" icon={PasskeyIcon} fullWidth loading={add.isPending} onClick={() => add.mutate()}>
          {passkeys.length === 0 ? `Sign in with ${word} next time` : "Add a passkey for this device"}
        </Button>
      }
    >
      {list.isPending ? (
        <ul>
          {[0, 1].map((i) => (
            <RowSkeleton key={i} />
          ))}
        </ul>
      ) : passkeys.length === 0 ? (
        <p className="text-body text-ink-soft">
          None yet. Add one on this device and the sign-in screen will offer it first. Your password keeps working.
        </p>
      ) : (
        <ul>
          {passkeys.map((passkey) => (
            <PasskeyRow
              key={passkey.id}
              passkey={passkey}
              renaming={renaming === passkey.id}
              onRename={() => setRenaming(passkey.id)}
              onDone={() => setRenaming(null)}
              onRemove={() => removePasskey(queryClient, passkey)}
            />
          ))}
        </ul>
      )}
    </Sheet>
  );
}

function PasskeyRow({
  passkey,
  renaming,
  onRename,
  onDone,
  onRemove,
}: {
  passkey: PasskeyInfo;
  renaming: boolean;
  onRename: () => void;
  onDone: () => void;
  onRemove: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(passkey.name);

  function save(event?: FormEvent) {
    event?.preventDefault();
    const next = name.trim();
    if (next && next !== passkey.name) void renamePasskey(queryClient, passkey.id, next);
    onDone();
  }

  return (
    <InfoRow
      icon={PhoneIcon}
      title={
        renaming ? (
          <form onSubmit={save}>
            <input
              aria-label="Passkey name"
              value={name}
              maxLength={40}
              onChange={(event) => setName(event.target.value)}
              onBlur={() => save()}
              onKeyDown={(event) => event.key === "Escape" && onDone()}
              // biome-ignore lint/a11y/noAutofocus: the person just chose to rename it
              autoFocus
              className="bg-paper text-body text-ink focus-ring h-9 w-full rounded-sm px-2 font-semibold"
            />
          </form>
        ) : (
          passkey.name
        )
      }
      meta={`Added ${relativeTime(passkey.createdAt)} · ${passkey.lastUsedAt ? `used ${inlineTime(passkey.lastUsedAt)}` : "not used yet"}`}
      actions={
        !renaming && (
          <>
            <IconButton icon={RenameIcon} label={`Rename ${passkey.name}`} onClick={onRename} />
            <IconButton icon={TrashIcon} label={`Remove ${passkey.name}`} onClick={onRemove} />
          </>
        )
      }
    />
  );
}
