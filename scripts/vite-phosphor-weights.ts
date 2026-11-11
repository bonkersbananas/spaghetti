/**
 * Vite plugin: Phosphor's icon files carry all six weights of each icon (thin, light, regular, bold, fill, duotone), and a
 * bundler can't drop the ones nobody asks for. The app draws regular, light, bold and fill only (scripts/check-design.ts
 * fails the others), so the build leaves thin and duotone out: about a third of every icon, 10 kB gzip of the first load.
 */
import type { Plugin } from "vite";

const unused = new Set(["thin", "duotone"]);
const entry = /\n {2}\[\n {4}"(\w+)",\n[\s\S]*?\n {2}\],?(?=\n {2}\[|\n\]\))/g;

export function phosphorWeights(): Plugin {
  return {
    name: "spaghetti:phosphor-weights",
    apply: "build",
    enforce: "pre",
    transform(code, id) {
      if (!/@phosphor-icons\/react\/dist\/defs\/[^/]+\.es\.js$/.test(id)) return null;
      let dropped = 0;
      const next = code.replace(entry, (whole, weight: string) => {
        if (!unused.has(weight)) return whole;
        dropped += 1;
        return "";
      });
      if (!dropped) return null;
      // The entry's own comma goes with it; a comma left before the closing bracket is harmless in an array literal.
      return { code: next, map: null };
    },
  };
}
