import type { ReactElement } from "react";
import { InviteIcon, PasskeyIcon, QrIcon } from "@/components/ui/icons";
import { MenuGroup, MenuItem } from "@/components/ui/Menu";
import { biometric, hasPasskeyHere } from "@/lib/passkeys";
import type { SigningInSheet } from "./SigningInSheets";

/**
 * The account menu's three sign-in rows: sign in on another device (what you reach for at the printer), invite
 * someone, and one "Passkeys and password" row (its second line nudges until this device has a passkey). Its own
 * chunk, so the icons and words stay out of every first load. `wrap` lets the desktop popover close itself.
 */
export default function SigningInRows({
  size,
  wrap = (row) => row,
  onPick,
}: {
  size: "md" | "sm";
  wrap?: (row: ReactElement) => ReactElement;
  onPick: (sheet: SigningInSheet) => void;
}) {
  const word = biometric();
  return (
    <MenuGroup size={size}>
      {wrap(
        <MenuItem icon={QrIcon} onClick={() => onPick("link")}>
          Sign in on another device
        </MenuItem>,
      )}
      {wrap(
        <MenuItem icon={InviteIcon} onClick={() => onPick("invite")}>
          Invite someone
        </MenuItem>,
      )}
      {wrap(
        <MenuItem
          icon={PasskeyIcon}
          onClick={() => onPick("passkeys")}
          hint={hasPasskeyHere() ? undefined : `Sign in with ${word} next time`}
        >
          Passkeys and password
        </MenuItem>,
      )}
    </MenuGroup>
  );
}
