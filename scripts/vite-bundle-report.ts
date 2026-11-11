/**
 * Vite plugin, on only with SPAGHETTI_BUNDLE_REPORT=1 (`pnpm build:report`): after the client build it prints
 * what the first load of the app holds. The entry's static imports are what every screen waits for; for each
 * chunk it lists the biggest modules (rendered size before gzip), and the dynamic chunks follow with their size.
 * A lightweight stand-in for rollup-plugin-visualizer, with nothing to install.
 */
import { gzipSync } from "node:zlib";
import type { Plugin } from "vite";

const kb = (bytes: number) => (bytes / 1024).toFixed(1).padStart(6);

export function bundleReport(): Plugin {
  return {
    name: "spaghetti:bundle-report",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      if (this.environment.name !== "client") return;
      const chunks = Object.values(bundle).filter((file) => file.type === "chunk");
      const byName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
      const entry = chunks.find((chunk) => chunk.isEntry);
      if (!entry) return;
      const seen = new Set<string>();
      const walk = (name: string) => {
        if (seen.has(name)) return;
        seen.add(name);
        for (const next of byName.get(name)?.imports ?? []) walk(next);
      };
      walk(entry.fileName);
      const gzip = (name: string) => gzipSync(byName.get(name)?.code ?? "").length;
      const lines: string[] = [];
      const total = [...seen].reduce((sum, name) => sum + gzip(name), 0);
      lines.push(`Static imports of the entry (every screen): ${seen.size} chunks, ${kb(total)} kB gzip`);
      for (const name of [...seen].sort((a, b) => gzip(b) - gzip(a))) {
        const chunk = byName.get(name);
        if (!chunk) continue;
        lines.push(`${kb(gzip(name))} kB gzip  ${name}`);
        const modules = Object.entries(chunk.modules)
          .map(([id, info]) => [id.replace(/^.*node_modules\//, "").replace(/^.*\/src\//, "src/"), info.renderedLength] as const)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 6);
        for (const [id, size] of modules) lines.push(`          ${kb(size)} kB raw  ${id}`);
      }
      const lazy = chunks.filter((chunk) => !seen.has(chunk.fileName));
      lines.push(`\nOn demand: ${lazy.length} chunks`);
      for (const chunk of lazy.sort((a, b) => gzip(b.fileName) - gzip(a.fileName)).slice(0, 25)) {
        lines.push(`${kb(gzip(chunk.fileName))} kB gzip  ${chunk.fileName}`);
      }
      console.log(`\n${lines.join("\n")}\n`);
    },
  };
}
