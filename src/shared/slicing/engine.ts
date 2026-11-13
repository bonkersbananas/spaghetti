/** What the app knows about the slicers it serves (docs/slicer.md): `virtual:slicer-engine`, from scripts/vite-slicer.ts. */
export interface SlicerEngineInfo {
  /** Where the engine's runtime folder is served, "/slicer/1/"; null when the dev server has none (offline). */
  base: string | null;
  /** The worker host's file in that folder: the page starts it by URL and talks to it by messages. */
  host: string;
  /** The engine release's version (`slicer-v1` is "1"). */
  version: string;
  engine: { name: string; repository: string; tag: string; commit: string; license: string };
  orca: { version: string; repository: string; commit: string };
  /** The release that carries this build's Corresponding Source. */
  source: string;
  /** Spaghetti's own slicer (slicer-rs in WebAssembly, decision 0055), served beside the engine. */
  rust: RustSlicerInfo;
}

export interface RustSlicerInfo {
  /** Where its folder is served, "/slicer/rust-1/"; null when the dev server has none. */
  base: string | null;
  /** The WebAssembly module's file in that folder. */
  wasm: string;
  /** The release's version (`slicer-rs-v1` is "1"). */
  version: string;
  /** The commit of Spaghetti's repository it was built from. */
  commit: string;
  /** The release that carries its source. */
  source: string;
}
