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
