# Support Fins, vendored

[Support Fins](https://github.com/gittrahan/support-fins) by gittrahan (MIT, see `v1.0.6/LICENSE`), the technique is Slant3D's. Copied **unmodified** from release `v1.0.6` (commit `3ede446fa337b0e7070c9fcefa15ae4ccd501fe8`): only the files its plugin entry point `plugins/shared/engine/fins_entry.js` imports (71 files with its `options.json`, plain mesh math, no dependencies), with the paths they have in that repository.

Spaghetti loads it only in the slice worker, only when a model is sliced with Fins (`src/client/lib/slicing/fins.ts`, decision 0051). To update it: read the project's changelog, check out the new tag, copy the closure of `fins_entry.js` into a new `vN/` folder, point the `@support-fins` alias (vite.config.ts, vitest.config.ts) at it and remove the old one. Never edit these files.
