import { useState } from "react";
import { DeviceLinkSheet } from "./DeviceLinkSheet";
import { InviteSheet } from "./InviteSheet";
import { PasskeysSheet } from "./PasskeysSheet";

export type SigningInSheet = "passkeys" | "link" | "invite";

/**
 * The sheets behind the account menu's "Signing in" rows, loaded together on the first press. Each is mounted
 * once it is asked for and then kept (a closed sheet that mounts while another is open looped in the production
 * build), so only the one the person chose is ever in the page.
 */
export default function SigningInSheets({
  which,
  onClose,
  onChangePassword,
}: {
  which: SigningInSheet | null;
  onClose: () => void;
  onChangePassword: () => void;
}) {
  const [asked, setAsked] = useState<ReadonlySet<SigningInSheet>>(new Set());
  if (which && !asked.has(which)) setAsked(new Set([...asked, which]));
  const props = (id: SigningInSheet) => ({
    open: which === id,
    onOpenChange: (open: boolean) => !open && onClose(),
  });
  return (
    <>
      {asked.has("passkeys") && <PasskeysSheet {...props("passkeys")} onChangePassword={onChangePassword} />}
      {asked.has("link") && <DeviceLinkSheet {...props("link")} />}
      {asked.has("invite") && <InviteSheet {...props("invite")} />}
    </>
  );
}
