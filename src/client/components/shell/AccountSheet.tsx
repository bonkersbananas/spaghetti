import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Suspense, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { AgentIcon, BellIcon, PaletteIcon, SignOutIcon, TrashIcon } from "@/components/ui/icons";
import { MenuGroup, MenuItem } from "@/components/ui/Menu";
import { Overline } from "@/components/ui/Overline";
import { Sheet } from "@/components/ui/Sheet";
import { RowSkeleton } from "@/components/ui/Skeleton";
import { peopleQuery, sessionQuery } from "@/lib/queries";
import { useSignOut } from "@/lib/use-sign-out";
import { LazyNotificationsSheet } from "./LazyNotificationsSheet";
import { ChangePasswordSheet, ProfilePhotoCrop, ProfilePhotoRow, SigningInRows, SigningInSheets } from "./lazy-account";
import type { SigningInSheet } from "./SigningInSheets";
import { workshop } from "./sections";
import { ThemeSwitch } from "./ThemeSwitch";

/** Phone-only: who is signed in, the two people, the styleguide, sign out. */
export function AccountSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { data: user } = useSuspenseQuery(sessionQuery);
  const people = useQuery({ ...peopleQuery, enabled: open });
  const signOut = useSignOut();
  const [changingPassword, setChangingPassword] = useState(false);
  const [notifying, setNotifying] = useState(false);
  const [cropping, setCropping] = useState<File | null>(null);
  const [signingIn, setSigningIn] = useState<SigningInSheet | null>(null);
  const [asked, setAsked] = useState({ notifying: false, password: false, photo: false, signingIn: false });
  if (signingIn && !asked.signingIn) setAsked({ ...asked, signingIn: true });
  const openSigningIn = (which: SigningInSheet) => {
    onOpenChange(false);
    setSigningIn(which);
  };
  if (notifying && !asked.notifying) setAsked({ ...asked, notifying: true });
  if (cropping && !asked.photo) setAsked({ ...asked, photo: true });
  if (changingPassword && !asked.password) setAsked({ ...asked, password: true });

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={onOpenChange}
        title="The kitchen"
        description="Two cooks, one notebook."
        footer={
          <Button variant="secondary" icon={SignOutIcon} fullWidth onClick={signOut}>
            Sign out
          </Button>
        }
      >
        <ul className="flex flex-col">
          {people.data || people.isError
            ? (people.data ?? (user ? [user] : [])).map((person) => {
                const row = (
                  <>
                    <Avatar person={person} size="md" />
                    <span className="text-body text-ink flex-1 font-semibold">{person.name}</span>
                    {person.id === user?.id && <span className="text-small text-ink-faint">You</span>}
                  </>
                );
                return person.id === user?.id ? (
                  // Your own row opens the photo picker; its code loads with the sheet (the plain row shows meanwhile).
                  <li key={person.id}>
                    <Suspense fallback={<div className="flex items-center gap-3 py-2.5">{row}</div>}>
                      <ProfilePhotoRow
                        variant="row"
                        onPick={(file) => {
                          onOpenChange(false);
                          setCropping(file);
                        }}
                      />
                    </Suspense>
                  </li>
                ) : (
                  <li key={person.id} className="flex items-center gap-3 py-2.5">
                    {row}
                  </li>
                );
              })
            : [0, 1].map((i) => <RowSkeleton key={i} />)}
        </ul>
        <Overline as="h3" className="mt-6 mb-2 block">
          Workshop
        </Overline>
        <MenuGroup label="Workshop">
          {workshop.map(({ to, label, icon }) => (
            <MenuItem key={to} to={to} icon={icon} onClick={() => onOpenChange(false)}>
              {label}
            </MenuItem>
          ))}
        </MenuGroup>
        <MenuGroup className="mt-6">
          <MenuItem to="/agents" icon={AgentIcon} onClick={() => onOpenChange(false)}>
            Agents
          </MenuItem>
          <MenuItem
            icon={BellIcon}
            onClick={() => {
              onOpenChange(false);
              setNotifying(true);
            }}
          >
            Notifications
          </MenuItem>
          <MenuItem to="/deleted" icon={TrashIcon} onClick={() => onOpenChange(false)}>
            Recently deleted
          </MenuItem>
          <MenuItem to="/styleguide" icon={PaletteIcon} onClick={() => onOpenChange(false)}>
            Styleguide
          </MenuItem>
        </MenuGroup>
        <div className="mt-6">
          <Suspense fallback={<div className="h-72" />}>
            <SigningInRows
              size="md"
              onPick={openSigningIn}
              onChangePassword={() => {
                onOpenChange(false);
                setChangingPassword(true);
              }}
            />
          </Suspense>
        </div>
        <ThemeSwitch className="mt-6" />
      </Sheet>
      {/* Mounted once asked for: their code loads then (lazy-account.ts), and a closed sheet that mounts while another is open looped in the production build. */}
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
