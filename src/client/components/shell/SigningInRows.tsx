import type { ReactElement } from "react";
import { DevicesIcon, InviteIcon, KeyIcon, PasskeyIcon, QrIcon } from "@/components/ui/icons";
import { MenuGroup, MenuItem } from "@/components/ui/Menu";
import { Overline } from "@/components/ui/Overline";
import { biometric, hasPasskeyHere } from "@/lib/passkeys";
import type { SigningInSheet } from "./SigningInSheets";

/**
 * The account menu's "Signing in" group. Its own chunk, so the icons and words for it stay out of every first
 * load: the phone's account sheet only renders it once the sheet is open. `wrap` lets the desktop popover close
 * itself when a row is chosen.
 */
export default function SigningInRows({
  size,
  wrap = (row) => row,
  onPick,
  onChangePassword,
}: {
  size: "md" | "sm";
  wrap?: (row: ReactElement) => ReactElement;
  onPick: (sheet: SigningInSheet) => void;
  onChangePassword: () => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      {size === "sm" ? (
        <Overline as="h3" className="px-0 pt-0.5">
          Signing in
        </Overline>
      ) : (
        <Overline as="h3" className="mb-1 block">
          Signing in
        </Overline>
      )}
      <MenuGroup size={size}>
        {wrap(
          <MenuItem icon={PasskeyIcon} onClick={() => onPick("passkeys")}>
            {hasPasskeyHere() ? "Passkeys" : `Sign in with ${biometric()} next time`}
          </MenuItem>,
        )}
        {wrap(
          <MenuItem icon={QrIcon} onClick={() => onPick("link")}>
            Sign in on another device
          </MenuItem>,
        )}
        {wrap(
          <MenuItem icon={DevicesIcon} onClick={() => onPick("devices")}>
            Signed-in devices
          </MenuItem>,
        )}
        {wrap(
          <MenuItem icon={InviteIcon} onClick={() => onPick("invite")}>
            Invite someone
          </MenuItem>,
        )}
        {wrap(
          <MenuItem icon={KeyIcon} onClick={onChangePassword}>
            Change password
          </MenuItem>,
        )}
      </MenuGroup>
    </div>
  );
}
