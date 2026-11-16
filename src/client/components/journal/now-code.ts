import type { ComponentType } from "react";

/**
 * The code of the phone Journal's Now block (heavy: the print cards, their motion and sheets), off the first load: the
 * Journal asks for it as it mounts on a phone. Not at the app's start: evaluating it then slowed the start itself on a
 * slow phone. It resolves only once Now's quiet lines are in too, so the block never suspends for them.
 */
let loaded: ComponentType | undefined;
let loading: Promise<unknown> | undefined;

export const loadNow = () =>
  (loading ??= import("./Now").then(async (module) => {
    await module.loadingLines;
    loaded = module.default;
  }));

export const nowCode = () => loaded;
