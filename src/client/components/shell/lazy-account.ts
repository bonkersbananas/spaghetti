import { lazy } from "react";

/**
 * Account code that loads on demand: the desktop account menu (the popover and what it opens), fetched while the
 * browser is idle or on the first press (Sidebar), and the change-password sheet, fetched when it is asked for.
 */
export const loadAccountMenu = () => import("./AccountMenu");
export const AccountMenu = lazy(loadAccountMenu);
export const ChangePasswordSheet = lazy(() =>
  import("./ChangePasswordSheet").then((module) => ({ default: module.ChangePasswordSheet })),
);
/** "Add a photo" and the crop sheet: their code loads when the account menu opens. */
export const ProfilePhotoRow = lazy(() => import("./ProfilePhoto").then((module) => ({ default: module.PhotoRow })));
export const ProfilePhotoCrop = lazy(() => import("./ProfilePhoto").then((module) => ({ default: module.PhotoCrop })));
export const loadThemeSwitch = () => import("./ThemeSwitch");
export const ThemeSwitch = lazy(() => loadThemeSwitch().then((module) => ({ default: module.ThemeSwitch })));
/** The "Signing in" sheets (passkeys and password, another device, invites): their code loads on the first press of one of those rows. */
export const SigningInSheets = lazy(() => import("./SigningInSheets"));
export const SigningInRows = lazy(() => import("./SigningInRows"));
