import type { Person } from "@shared/api";
import { Suspense, useState } from "react";
import {
  AgentIcon,
  BellIcon,
  DevicesIcon,
  InviteIcon,
  KeyIcon,
  PaletteIcon,
  PasskeyIcon,
  QrIcon,
  SignOutIcon,
  TrashIcon,
} from "@/components/ui/icons";
import { MenuGroup, MenuItem } from "@/components/ui/Menu";
import { Overline } from "@/components/ui/Overline";
import { Popover, PopoverClose } from "@/components/ui/Popover";
import { biometric, hasPasskeyHere } from "@/lib/passkeys";
import { useSignOut } from "@/lib/use-sign-out";
import { AccountButton } from "./AccountButton";
import { LazyNotificationsSheet } from "./LazyNotificationsSheet";
import { ChangePasswordSheet, ProfilePhotoCrop, ProfilePhotoRow, SigningInSheets } from "./lazy-account";
import type { SigningInSheet } from "./SigningInSheets";
import { ThemeSwitch } from "./ThemeSwitch";

/** The sidebar's account menu (desktop), loaded on demand by the Sidebar. */
export default function AccountMenu({ user, defaultOpen }: { user: Person; defaultOpen: boolean }) {
  const signOut = useSignOut();
  const [changingPassword, setChangingPassword] = useState(false);
  const [notifying, setNotifying] = useState(false);
  const [cropping, setCropping] = useState<File | null>(null);
  const [signingIn, setSigningIn] = useState<SigningInSheet | null>(null);
  const [asked, setAsked] = useState({ notifying: false, password: false, photo: false, signingIn: false });
  if (signingIn && !asked.signingIn) setAsked({ ...asked, signingIn: true });
  if (notifying && !asked.notifying) setAsked({ ...asked, notifying: true });
  if (cropping && !asked.photo) setAsked({ ...asked, photo: true });
  if (changingPassword && !asked.password) setAsked({ ...asked, password: true });
  return (
    <>
      <Popover
        label="Account"
        side="top"
        align="start"
        defaultOpen={defaultOpen}
        trigger={<AccountButton user={user} />}
      >
        <div className="flex flex-col gap-3">
          <Suspense fallback={<div className="h-14" />}>
            <ProfilePhotoRow onPick={setCropping} />
          </Suspense>
          <div className="bg-hairline h-px" />
          <ThemeSwitch />
          <MenuGroup size="sm">
            <PopoverClose asChild>
              <MenuItem to="/agents" icon={AgentIcon}>
                Agents
              </MenuItem>
            </PopoverClose>
            <PopoverClose asChild>
              <MenuItem icon={BellIcon} onClick={() => setNotifying(true)}>
                Notifications
              </MenuItem>
            </PopoverClose>
            <PopoverClose asChild>
              <MenuItem icon={InviteIcon} onClick={() => setSigningIn("invite")}>
                Invite someone
              </MenuItem>
            </PopoverClose>
          </MenuGroup>
          <div className="bg-hairline h-px" />
          <div className="flex flex-col gap-1">
            <Overline as="h3" className="px-0 pt-0.5">
              Signing in
            </Overline>
            <MenuGroup size="sm">
              <PopoverClose asChild>
                <MenuItem icon={PasskeyIcon} onClick={() => setSigningIn("passkeys")}>
                  {hasPasskeyHere() ? "Passkeys" : `Sign in with ${biometric()} next time`}
                </MenuItem>
              </PopoverClose>
              <PopoverClose asChild>
                <MenuItem icon={QrIcon} onClick={() => setSigningIn("link")}>
                  Sign in on another device
                </MenuItem>
              </PopoverClose>
              <PopoverClose asChild>
                <MenuItem icon={DevicesIcon} onClick={() => setSigningIn("devices")}>
                  Signed-in devices
                </MenuItem>
              </PopoverClose>
              <PopoverClose asChild>
                <MenuItem icon={KeyIcon} onClick={() => setChangingPassword(true)}>
                  Change password
                </MenuItem>
              </PopoverClose>
            </MenuGroup>
          </div>
          <div className="bg-hairline h-px" />
          <MenuGroup size="sm">
            <PopoverClose asChild>
              <MenuItem to="/deleted" icon={TrashIcon}>
                Recently deleted
              </MenuItem>
            </PopoverClose>
            <PopoverClose asChild>
              <MenuItem to="/styleguide" icon={PaletteIcon}>
                Styleguide
              </MenuItem>
            </PopoverClose>
            <MenuItem icon={SignOutIcon} onClick={signOut}>
              Sign out
            </MenuItem>
          </MenuGroup>
        </div>
      </Popover>
      {/* Mounted once asked for. In the production build, a closed sheet that mounts while another sheet is open (the share sheet) looped (React error 185). */}
      {asked.notifying && <LazyNotificationsSheet open={notifying} onOpenChange={setNotifying} />}
      {asked.photo && (
        <Suspense fallback={null}>
          <ProfilePhotoCrop file={cropping} onFile={setCropping} onClose={() => setCropping(null)} />
        </Suspense>
      )}
      {asked.signingIn && (
        <Suspense fallback={null}>
          <SigningInSheets which={signingIn} onClose={() => setSigningIn(null)} />
        </Suspense>
      )}
      {asked.password && (
        <Suspense fallback={null}>
          <ChangePasswordSheet open={changingPassword} onOpenChange={setChangingPassword} />
        </Suspense>
      )}
    </>
  );
}
