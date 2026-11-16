// Module hooks that let Node run the app's slice worker (src/client/lib/slicing/slice-worker.ts) as Vite builds it:
// the import aliases (@/, @shared/, @support-fins/), extensionless relative imports of .ts files, and the worker's
// `./ours` swapped for app-ours.mts, which records what the worker hands Spaghetti's slicer. Registered by
// app-slice.mts (module.registerHooks); see its header.
import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../../..");
const aliases = [
  ["@shared/", join(root, "src/shared/")],
  ["@support-fins/", join(root, "vendor/support-fins/v1.0.6/")],
  ["@/", join(root, "src/client/")],
];

/** The file a path names, trying the extensions Vite would. */
function file(path) {
  for (const candidate of [path, `${path}.ts`, `${path}.mts`, `${path}.js`, join(path, "index.ts")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

export function resolve(specifier, context, next) {
  const parent = context.parentURL ? fileURLToPath(context.parentURL) : "";
  if (specifier === "./ours" && parent.endsWith("slice-worker.ts")) {
    return { url: pathToFileURL(join(here, "app-ours.mts")).href, shortCircuit: true };
  }
  for (const [prefix, dir] of aliases) {
    if (specifier.startsWith(prefix)) {
      const found = file(join(dir, specifier.slice(prefix.length)));
      if (found) return { url: pathToFileURL(found).href, shortCircuit: true };
    }
  }
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && parent) {
    const found = file(join(dirname(parent), specifier));
    if (found) return { url: pathToFileURL(found).href, shortCircuit: true };
  }
  return next(specifier, context);
}
