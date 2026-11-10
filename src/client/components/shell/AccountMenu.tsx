import type { Person } from "@shared/api";
import { Suspense, useState } from "react";
import { AgentIcon, BellIcon, KeyIcon, PaletteIcon, SignOutIcon, TrashIcon } from "@/components/ui/icons";
import { MenuGroup, MenuItem } from "@/components/ui/Menu";
import { Popover, PopoverClose } from "@/components/ui/Popover";
import { useSignOut } from "@/lib/use-sign-out";
import { AccountButton } from "./AccountButton";
import { LazyNotificationsSheet } from "./LazyNotificationsSheet";
import { ChangePasswordSheet } from "./lazy-account";
import { ThemeSwitch } from "./ThemeSwitch";

/** The sidebar's account menu (desktop), loaded on demand by the Sidebar. */
export default function AccountMenu({ user, defaultOpen }: { user: Person; defaultOpen: boolean }) {
  const signOut = useSignOut();
  const [changingPassword, setChangingPassword] = useState(false);
  const [notifying, setNotifying] = useState(false);
  const [asked, setAsked] = useState({ notifying: false, password: false });
  if (notifying && !asked.notifying) setAsked({ ...asked, notifying: true });
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
              <MenuItem icon={KeyIcon} onClick={() => setChangingPassword(true)}>
                Change password
              </MenuItem>
            </PopoverClose>
          </MenuGroup>
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
      {asked.password && (
        <Suspense fallback={null}>
          <ChangePasswordSheet open={changingPassword} onOpenChange={setChangingPassword} />
        </Suspense>
      )}
    </>
  );
}
