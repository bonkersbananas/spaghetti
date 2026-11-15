# Slicing on several threads in the browser

A spike (session #1271) on whether Spaghetti should serve its pages cross-origin isolated so that the slicers can use threads. Nothing here is turned on: this is the numbers and a recommendation, for Carl Oscar to decide.

## Short answer

**Not now. Threads are real and work in both browsers, but they pay least where the app slices most and cost the most memory where memory is scarcest.**

- OrcaSlicer's engine on 4 threads slices **2.0 to 2.6 times** faster than its single-threaded build in Chromium (a Benchy in 2.6 s against 5.2 s, the first slice after loading) and 1.4 to 2.3 times in WebKit. Its output is unchanged. But it keeps a 1.25 GB shared heap: in WebKit it peaked at 1.44 GB in one process for four Benchies (1.12 GB single-threaded), which is the size at which iPhones kill tabs.
- Spaghetti's own slicer (not yet the default: `DEFAULT_SLICER` is still `orca`, and ours becomes the default after a test print), the one that matters here, slices a Benchy in 2.8 s on one thread. On threads (a prototype, 190 lines, byte-identical output) it takes 1.7 s on the first slice and 1.1 s once the threads are warm. The prototype needs Rust nightly with `-Zbuild-std`, and on a phone's mix of fast and slow cores it would gain less than here. Its first slice is also where the gain is smallest, and every slice in the app is a first slice (a new worker each time).
- Turning isolation on broke nothing we found in the seeded app, in Chromium and in WebKit. Everything the app shows is already same-origin. The costs are in the headers (every response, including worker scripts and the cached app shell, must carry them), in the rule that no cross-origin resource can ever be hotlinked again (Safari lacks `credentialless`), and in `window.opener` being cut for popups.

The case for it would be big plates (12 Benchies take 35 s on one thread) or a slower slicer as the default. Neither is the app's use today: models are sliced once, in the background, next to the printer. Cheaper things come first: keep the slice worker alive between slices, and see section 6.

## 1. What threads need

`SharedArrayBuffer`, which a page gets only when it is cross-origin isolated: `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` or `credentialless` on the document, and the same `Cross-Origin-Embedder-Policy` on every worker script it starts. `crossOriginIsolated` then reads true.

`credentialless` lets a page load cross-origin images and scripts without the other side's consent (they are fetched without cookies). **Chromium supports it; WebKit does not.** In this sandbox's WebKit (Playwright 1.65, WebKit 27.2) a page with `credentialless` is not isolated (`crossOriginIsolated` false, no `SharedArrayBuffer`); with `require-corp` it is. iPhones run WebKit, so `require-corp` is the only choice, and with it every cross-origin resource must opt in with `Cross-Origin-Resource-Policy` or CORS.

## 2. OrcaSlicer's engine

The engine's build has a multithreaded variant (`engine-mt`: pthreads and oneTBB, with a host that pre-grows its shared heap to 1,280 MB, [the engine's own notes](https://github.com/Muon-3D/muon3d-slicer-engine/tree/main/docs/performance/mt-crash-2026-10-16) say why: V8 can trap on atomic accesses to memory another thread has just grown, which crashed some first slices). Our `scripts/slicer/build.sh` builds only `st`. For this spike I built `mt` from the same pin (engine v0.6.1 with `engine.patch`, OrcaSlicer v2.5.1) by running the same script with the variant set to `mt`: it builds, about 11 minutes on four cores with a cold ccache, with no change to the patch. `engine-mt.wasm` is 12.75 MB (2.65 MB brotli), against 11.96 MB (2.56 MB) for `st`.

**Method.** Chromium 1254 headless and Playwright's WebKit (Linux WPE, 27.2), on this sandbox's four ARM cores with nothing else running. The page is served with COOP and `require-corp` for `mt` and with no isolation for `st`. The engine's host runs in a Web Worker as in the app; `load` takes `variant` and `threads`. Time is from sending `slice` to its result (engine loaded), for the first slice in a fresh browser and for a second one in the same worker. The app starts a new slice worker, and so a new engine, for every slice, so the first number is the one people get. Models are placed on the X2D's plate with the app's defaults (0.20 mm Standard, Bambu PLA Basic, no supports): a Benchy (225,154 triangles), four Benchies, the Stanford bunny (52,716 triangles, 118 mm tall, 592 layers) and Orca's `ksr_fdmtest_v4` (12,234 triangles, 92 mm tall), the last two from Orca's own `resources/handy_models`. Carl Oscar's glasses and text models are not in the sandbox.

Seconds, first slice / second slice, speed-up over `st` in brackets:

| | `st` | 2 threads | 4 threads |
| --- | --- | --- | --- |
| Chromium, Benchy | 5.2 / 4.6 | 3.2 / 2.6 (1.6× / 1.8×) | 2.6 / 1.8 (2.0× / 2.6×) |
| Chromium, bunny | 12.6 / 11.9 | 6.8 / 6.1 (1.9× / 1.9×) | 4.9 / 3.7 (2.6× / 3.2×) |
| Chromium, FDM test | 5.5 / 5.0 | 3.4 / 2.8 (1.6× / 1.8×) | 2.8 / 1.9 (2.0× / 2.6×) |
| Chromium, 4 Benchies | 19.4 | 11.2 (1.7×) | 7.7 (2.5×) |
| WebKit, Benchy | 4.9 / 4.5 | 3.5 / 2.5 (1.4× / 1.8×) | 3.5 / 1.6 (1.4× / 2.9×) |
| WebKit, bunny | 11.6 / 11.2 | 6.8 / 5.8 (1.7× / 1.9×) | 5.4 / 3.5 (2.2× / 3.2×) |
| WebKit, FDM test | 5.4 / 4.8 | 3.7 / 2.6 (1.5× / 1.9×) | 3.8 / 1.9 (1.4× / 2.5×) |
| WebKit, 4 Benchies | 17.6 | 10.6 (1.7×) | 7.9 (2.3×) |

- G-code length, estimate and grams are identical across `st`, 2 and 4 threads, in both browsers (Benchy 2,518,429 bytes, bunny 17,639,800, FDM test 5,954,165, four Benchies 9,563,127), so threads don't change the output.
- The first slice is slower than the second by 0.5 to 2 s on threads (WebKit, 4 threads: 3.5 s then 1.6 s): the thread pool and the browser's compilation of the module's hot functions warm up. Only `st` has little of it.
- A phone doesn't have four equal cores. These are four server-class ARM cores. Take the figures as the ceiling.

**Memory** (how much the browser's processes grew while slicing, and the biggest process in brackets; two runs each, within 10 % of each other, one slice in a fresh browser):

| | `st` | 4 threads |
| --- | --- | --- |
| Chromium, Benchy | 1,285 MB (1,370) | 559 MB (642) |
| Chromium, 4 Benchies | 1,300–1,370 MB (1,385–1,455) | 870–880 MB (950–965) |
| WebKit, Benchy | 470 MB (670) | 565 MB (750) |
| WebKit, 4 Benchies | 900–955 MB (1,080–1,125) | 1,280 MB (1,440) |

In Chromium `mt` used less than `st`; I haven't found why (probably that growing a non-shared memory copies it where a shared one is reserved up front and grows in place). In WebKit it used more, and four Benchies reached 1.28 GB, which is the host's heap reserve touched whole. An iPhone gives a tab somewhere between 1 and 2 GB before it kills it (not measured here: no device), so the engine's `mt` is at the edge exactly where `st` has headroom. Isolation alone (the `st` engine on an isolated page) changed nothing: 1,186–1,292 MB against 1,284 MB in Chromium, 475 against 465 MB in WebKit.

## 3. Our own slicer

`slicer-rs` already runs its stages on threads natively through rayon, in three helpers (`par::map_range`, `map_vec`, `join` in `src/lib.rs`), and native scaling is 3.3× on four threads (a Benchy 2.03 s to 0.62 s). In WebAssembly it runs on one, because the module has no threads.

**What it takes.** (1) A nightly Rust: `-C target-feature=+atomics,+bulk-memory,+mutable-globals` needs the standard library rebuilt with them (`-Z build-std=std,panic_abort`), and `memory.atomic.wait32` is behind `#![feature(stdarch_wasm_atomic_wait)]`. (2) A linker line for shared, imported memory and exports for the thread-local storage and the stack pointer (`--shared-memory --import-memory --max-memory=… --export=__wasm_init_tls …`). (3) The global allocator can't be Talc's unsynchronised one: the prototype uses the standard library's (dlmalloc with a lock), which is also why the module grows from 3.78 MB to 4.57 MB (1.27 to 1.35 MB gzip). (4) A pool: `wasm-bindgen-rayon` is the known way but needs `wasm-bindgen` glue, which the module has none of (`src/wasm.rs` is a plain C interface); the prototype instead has `src/pool.rs` (130 lines), a fork-join pool on `memory.atomic.wait32`/`notify` behind the same three helpers, with a host (`rs-worker.js`) that gives each Web Worker a stack and thread-local block and calls `pool_worker`. A job started inside a job runs serially. (5) The slice must run in a worker, since the main thread of a page may not block on an atomic wait: it already does.

**Determinism.** The Benchy's `.gcode.3mf` comes out byte for byte the same on 1, 2 and 4 threads and as the stock single-threaded module's (md5 `6e72564b…`; checked in Node, and the sizes agree in both browsers), which is the existing rule (native and WebAssembly agree). Everything is by index and collected in order, so it follows from the helpers' design, not from luck, but only the Benchy was compared byte for byte.

Seconds, first slice / third slice, in one page that slices three times (speed-up over the stock single-threaded module in brackets):

| | stock, 1 thread | 2 threads | 4 threads |
| --- | --- | --- | --- |
| Chromium, Benchy | 2.8 / 2.5 | 1.8 / 1.5 (1.5× / 1.7×) | 1.7 / 1.1 (1.7× / 2.4×) |
| Chromium, bunny | 13.8 / 13.4 | 7.9 / 7.6 (1.7× / 1.8×) | 6.3 / 7.4 (2.2× / 1.8×) |
| Chromium, FDM test | 4.0 / 3.8 | 2.5 / 2.3 (1.6× / 1.6×) | 3.2 / 1.9 (1.3× / 2.0×) |
| Chromium, 4 Benchies | 10.2 / 9.7 | 6.2 / 5.8 (1.6× / 1.7×) | 7.8 / 5.9 (1.3× / 1.6×) |
| WebKit, Benchy | 2.6 / 2.4 | 1.8 / 1.4 (1.4× / 1.7×) | 3.6 / 1.2 (0.7× / 2.0×) |
| WebKit, bunny | 12.6 / 12.4 | 7.6 / 7.1 (1.7× / 1.8×) | 7.1 / 4.6 (1.8× / 2.7×) |
| WebKit, FDM test | 3.6 / 3.4 | 2.5 / 2.1 (1.4× / 1.6×) | 4.6 / 1.9 (0.8× / 1.8×) |
| WebKit, 4 Benchies | 9.2 / 8.9 | 5.7 / 5.2 (1.6× / 1.7×) | 7.4 / 3.9 (1.2× / 2.3×) |

- The threaded module on one thread costs nothing (0.97 to 0.99×), so the build itself isn't slower.
- Two threads give a steady 1.4 to 1.7× from the first slice. Four give 2 to 2.7× when warm, but the first slice on four threads is often not faster than on two, and in WebKit it was slower than the stock module for a Benchy and the FDM test (3.6 s and 4.6 s against 2.6 s and 3.6 s). I did not find out why (each thread starting in its baseline tier and compiling the same functions again is my guess). Since the app starts a new slice worker for each slice, this is the figure that counts, and keeping the pool alive across slices, which the app doesn't do today, would be part of the work.
- Variance is high (the bunny on four threads in Chromium: 6.3, 6.0 and 7.4 s): the sandbox's browser also needs a core.
- Heap: the threaded module needs a declared maximum for its shared memory (1 GB here, 64 MB first); a Benchy used 64 MB, nothing grew. A plate that does grow memory while threads run meets the same V8 race the engine's notes describe, which the Orca host works around by growing before the job. The prototype doesn't, and the slices run for these tables didn't crash, but that is not proof; a real version would pre-grow like the engine's host. Browser peaks were 30 to 90 MB more than single-threaded in both browsers (four Benchies: Chromium 253 MB against 223, WebKit 335 against 288).
- Extra work a real version would need: a nightly pin in `rust-toolchain.toml` or CI, the slicer-rs release workflow building a second module (or replacing the first, if the app can't run threadless), `slicer-rs`'s own tests running the threaded build, cancellation (terminate the worker; the pool dies with it) and the app picking the threaded module only when `crossOriginIsolated`.

## 4. What isolation breaks in the app

I ran the production build on workerd with the screenshot seed, behind a proxy that adds the two headers, and drove it in Chromium and WebKit: signed in, opened Today, Ideas, Builds, Pantry and Printer, counted every `<img>` that decoded, let the service worker take over, reloaded, went offline and reloaded, started the engine host as a worker, and loaded one image from another origin. (`app-test.mjs` on the spike branch.)

| | `require-corp` on everything | `credentialless` | headers on documents only |
| --- | --- | --- | --- |
| Chromium: isolated, all images decoded (18/18, 21/21, 6/6, 3/3), engine host worker starts | yes | yes (isolated) | isolated on first load; **worker scripts blocked**; after the service worker's reload no longer isolated |
| WebKit: same | yes, also after the service worker's reload and offline | **not isolated** | as Chromium |
| A cross-origin image, no CORP | blocked | loaded (Chromium only) | blocked |

What each part of the app needs:

- **Pictures** (idea and build photos, thumbnails, link cards, MakerWorld and shop pictures, avatars, scout pictures): nothing. They are all `/api/…` URLs on our own origin. MakerWorld, Thingiverse and shop pictures are fetched and stored in R2 by the Worker (`worker/draft/run.ts`, `worker/scout/run.ts`) and the browser never loads the other site's address; avatars are uploaded. `/api` already sends `Cross-Origin-Resource-Policy: same-origin` and COOP. A future `<img src="https://…">` of someone else's would break on iPhones for good, whatever Chromium allows.
- **Fonts, scripts, styles:** same-origin, self-hosted. Nothing.
- **Headers to add:** on every document the Worker answers (`page-headers.ts`, which says `public/_headers` doesn't reach those), on the static assets through `public/_headers` (`/assets/*`, `/slicer/*`, `/sw.js`; the engine's host and its pthreads start as workers from `/slicer/…`, and the app's own workers from `/assets/…`), and on the app shell the service worker caches. The last is a trap: the service worker fetches `/?shell` and keeps the response with its headers (`sw.js`), so that fetch must carry them, or the app is isolated on first load and not after a reload or offline (the "documents only" column).
- **Service worker and push:** worked, installed, controlling the page and answering offline, with the headers on the shell. Push and notification clicks don't involve the page's policies. The share target (`POST /share`, answered by the service worker with a redirect) is same-origin.
- **Web Share** (`navigator.share`): not affected by COOP/COEP.
- **Bambu Studio hand-off links** (`bambustudio://`, `bambustudioopen://`): custom-scheme navigations, not affected. Bambu Studio fetches the signed `/open/…` file link itself, with no browser.
- **Sign-in:** passkeys and passwords happen on our own page; no popup, nothing to break.
- **OAuth for MCP clients** (`/authorize`, `/oauth/*`): COOP same-origin cuts `window.opener` between a client's popup and our consent screen. A client that opens `/authorize` in a popup and waits on `window.opener` after the redirect would stop working. Leave those routes without COOP (the isolation is per document: they don't slice). Not tested: I don't have a client that does it either way.
- **External links** already use `rel="noreferrer noopener"`. With COOP a link to another site opened in a new tab loses its opener either way.
- **Dev, e2e, container:** Vite's dev server (`server.headers`), wrangler's local assets (`_headers` is read), the e2e servers and the container run the same Worker; the headers have to be in all of them or the slicer test silently runs threadless. The Worker would need a switch so the single-threaded fallback stays.
- **Not isolated browsers:** A browser that doesn't isolate (an in-app browser, an old iOS; Firefox I didn't test) gets no threads. The app must feature-detect and keep the single-threaded modules, so nothing here removes them.

## 5. Recommendation

1. **Don't turn on isolation for the Orca engine.** It's the fallback for what ours can't slice, it gains the most (2 to 3× warm), and it has the worst memory on WebKit. If it's wanted anyway, the engine's host reserve (1.25 GB) is the setting to look at first, and a real iPhone must be tried.
2. **Don't turn it on for slicer-rs yet either.** A 1.1 s Benchy becoming 0.6 s helps nobody who isn't waiting on it, and the cold-start result (the same or slower on the first slice, which is the app's only kind) would have to be solved first. The prototype is on the branch `spike/browser-threads-prototype` if this is picked up.
3. **Do the cheaper things first**, none of which needs isolation: keep the slice worker alive so its second slice is warm (`slice-model.ts` makes a new one each time; the engine's second slice is already 5 to 10 % faster on `st`), and keep the single-threaded builds as the base case whatever is added.
4. **If speed on big plates matters later**, there is a middle path that needs no headers: independent objects (copies) are sliced separately and each worker has its own memory and does the regions stage (58 % of a Benchy), with the results copied back to one worker for toolpaths and G-code. I haven't tried it, and the G-code's layer-by-layer order across objects would need merging.
5. **When to revisit:** if plates of many objects become common (12 Benchies is 35 s single-threaded in our slicer), if the slicer used by default gets slower, or if an iPhone's tab limit is measured and has room. Then isolate in one go: headers on the Worker, `_headers`, the dev server and the container, the OAuth routes excluded, plus a test that fails if `crossOriginIsolated` is false in the built app.

## 6. What this did not measure

- No phone. WebKit here is Playwright's Linux build (JavaScriptCore, no iOS jetsam), and the cores are four equal ARM server cores.
- Only the Benchy was compared byte for byte for slicer-rs on threads; Orca's outputs were compared by size, estimate and grams.
- Carl Oscar's own models (glasses, UOBF text) were not available; the bunny and Orca's FDM test stand in.
- Tree supports, several filaments and the plate's thumbnail were not run on threads.
- The prototype ran about a hundred slices in both browsers with no failure; a day of use could find the grown-memory race.
- The audit used the seeded app; it did not run a slice through the app's own UI on an isolated page, though the engine's host started and the engine ran in the harness's identical setup (a host worker starting pthread workers).
