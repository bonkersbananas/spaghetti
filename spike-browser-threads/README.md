Throwaway spike for docs/proposals/browser-threads.md (session #1271). Not for merging.

- `slicer-rs/src/pool.rs`, the `wasm-threads` feature in `slicer-rs/src/lib.rs` and `Cargo.toml`: a fork-join pool on WebAssembly threads behind `par::map_range`/`join`. Build it with the config in `slicer-rs/.cargo-threads/config.toml` copied to `slicer-rs/.cargo/config.toml`: `cargo +nightly rustc --release --lib --crate-type cdylib --no-default-features --features wasm-threads`.
- `build-orca-mt.sh`: scripts/slicer/build.sh cut off after the engine and with the variant set to `mt` (run with SLICER_SYSTEM_TOOLS=1, JOBS=4).
- `drive2.mjs`, `page.html`, `rs-worker.js`, `job2.sh`, `matrix.sh`, `mem.sh`: the Chromium/WebKit timing and memory harness (paths are the sandbox's: /tmp/eng, /tmp/models). `app-test.mjs` runs the built, seeded app behind a proxy that adds COOP/COEP.
