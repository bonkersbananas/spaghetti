import { lazy } from "react";

/** The account sheet (phones) and the account menu (desktop) load on demand: see useWhenIdle. */
export const loadAccountSheet = () => import("./AccountSheet");
export const loadAccountMenu = () => import("./AccountMenu");
export const LazyAccountSheet = lazy(() => loadAccountSheet().then((module) => ({ default: module.AccountSheet })));
export const AccountMenu = lazy(loadAccountMenu);
