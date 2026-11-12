# The landing page

What someone signed out sees at https://spaghetti.day/: one bright page that shows Spaghetti off and has Sign in on it, twice. Signed in, the same address is the app, as before. Why it is built this way: [decision 0035](decisions/0035-a-landing-page-at-the-root-for-visitors.md).

## How it is served

- **`landing.html`** (next to the app's `index.html`) is a static page with its own stylesheet (`src/landing/landing.css`) and one small script (`src/landing/landing.ts`). It imports nothing of the app's code: only the tokens (`tokens.css`) and the two faces, so it is clearly the same product. It is a second page of the Vite client build (`scripts/vite-landing.ts`), written to `dist/client/landing.html` and `assets/landing/`.
- **`/` reaches the Worker first** (`run_worker_first` in wrangler.jsonc). `src/worker/home.ts` serves the app (`index.html`) when the request has a session cookie and `landing.html` when it hasn't, with `Cache-Control: private, no-cache` and `Vary: Cookie`. It checks the cookie's presence only, no database read: a stale cookie opens the app, which sends its owner to sign in.
- **The service worker** (`src/sw/sw.js`) fetches its app shell from `/?shell`, which the Worker answers with the app for anyone (`/` alone may be the landing page while it installs, and an app route like `/today` gets `index.html` on Cloudflare only as a navigation, which its fetch isn't), asks the network what `/` is (and opens the app from the cache when there is no answer within 3 s), and leaves `/landing` and `assets/landing/` to the network. The landing's files are left out of the app's precache.
- **The app is untouched.** The landing's files have their own names, and the module-preload polyfill Vite would share between the two pages is left out of the landing's entry, so the app's build output is byte for byte what it was and the first-load budgets in `e2e/performance.spec.ts` don't move. `@source not` in `app.css` keeps Tailwind from reading the landing page for class names.
- **Headers:** `public/_headers` caches `/assets/landing/*` for a year (hashed names) and `/og.jpg` for a day.
- **In development** `pnpm dev` serves it the same way at `/` (signed out) and at `/landing`.

## The page

Bright and light only (`color-scheme: light`, no dark mode): a stack of coloured sheets (sunflower, pink, paper, teal, tomato) laid over each other, the app's type turned up, photos of prints and the app in a phone and a laptop drawn in CSS around real screenshots. The moments:

- the name prints itself layer by layer under a nozzle fed by four spools, then gets its Worked chip;
- things arrive as they come into view (a strand draws itself, the attempt thread grows, the timer fills, the search types, the print's progress moves);
- the AMS spools turn as the page scrolls, the photo strip drifts sideways, a tape of Worked · Partly · Spaghetti runs across;
- "How did it go?" has the app's three answers to tap, each with its own little burst.

The devices are drawn in CSS around the screenshots, one of each everywhere on the page. The phone is an iPhone (`.lp-phone`): a 390 × 844 screenshot taken at 3x as the Home Screen app fills its screen edge to edge, and the status bar, Dynamic Island and home indicator are drawn on it over the app's own safe-area insets, every size a share of the phone's width. The laptop (`.lp-laptop`) has a MacBook's notch, the bezel's black dipping into the top of the screen. The share image draws the same iPhone.

With `prefers-reduced-motion` every one of these is at its end state at once, and without the script everything is simply there. Copy follows the app's voice (docs/design.md, Voice). It never offers sign-up or a waiting list.

## The pictures: `pnpm landing:shots`

Every picture on the page is made by one command, from the app itself and the photos in this repository, and committed in `src/landing/images` (plus `public/og.jpg`). Run it again whenever the app's screens change, or after changing what the demo shows:

```sh
pnpm landing:shots             # the app's screenshots, then every picture (a few minutes)
pnpm landing:shots --pictures  # only the pictures, from the screenshots already in screenshots/landing
```

It needs the Playwright browser (`pnpm exec playwright install chromium-headless-shell`); `sharp`, a dev dependency, crops and encodes.

1. **Screenshots** (`scripts/landing-shots.ts`): it starts the app on a throwaway database with the screenshot seed (`scripts/seed`, the same fake data as `pnpm screenshots`), makes its two people M and CO with their pictures and adds what `scripts/landing/demo.ts` says, and takes each screen in the light theme on a phone (390 × 844 at 3x, as the Home Screen app on an iPhone, safe areas and all) and a laptop (1440 × 900 at 2x), into `screenshots/landing` (gitignored).
2. **Pictures** (`scripts/landing/pictures.ts`): photos cropped and warmed a little toward the paper, app screens set in perspective onto the laptop in the two desk photos (by the browser, with a CSS `matrix3d`), and the share image (`public/og.jpg`, 1200 × 630, drawn by the browser). Each is saved as AVIF at a few widths and one WebP fallback, named `<name>-<width>.avif` and `<name>.webp`.

### What to change where

| You want to… | Change |
| --- | --- |
| Rename the two people, change their colours or pictures | `PEOPLE` in `scripts/landing/demo.ts`; pictures go in `scripts/landing/people` (any size, cut square). They show only in the app's screenshots (and the share image's phone); the general screenshot seed for `pnpm screenshots` keeps its Alex and Sam. |
| Show a different screen, or a screen in another state | `SHOTS` in `scripts/landing/demo.ts`: a path and a `prepare` step (open a sheet, type a search), or `reuse()` a shot of `pnpm screenshots` by name. Then add it to `PICTURES` in `scripts/landing/pictures.ts` and to `landing.html`. |
| Put a real photo where the seed has a drawing | `STAND_INS` in `scripts/landing/demo.ts` (the photo and the crop that has the drawing's shape); `RENAMES` there keeps the words in step with the photo. |
| Add an idea to the demo | `ADDITIONS` in `scripts/landing/demo.ts`. |
| Add a photo of a print to the page | Put it in `scripts/landing/photos` (JPEG, about 1000–1500 px wide), add a `Picture` to `PICTURES` (its widths are never wider than the source), run `pnpm landing:shots --pictures`, then add a `<picture>` to `landing.html` like the others: an AVIF `srcset` of the widths with `sizes` for how wide it shows, the WebP as the `<img>`'s `src`, `width`/`height`, a real `alt`, and `loading="lazy"` below the fold. |
| Put another screen on a laptop in a photo | `SCREENS` in `scripts/landing/pictures.ts` has the four corners of each laptop's screen, measured on the photo; a picture made with `onTheLaptop(photo, screenshot)`. |
| Change the share image | `shareImage()` in `scripts/landing/pictures.ts`. |

The photos in `scripts/landing/photos` are mock-ups made for this page; none of it is real data, and the shots never touch production. The two people appear only in the app's screenshots, as M and CO with their own pictures; the page's own toasts and notes say what happened, not who did it.

### Weight

At 390 px the whole page, scrolled to the end, is about 0.6 MB (measured on the production build), most of it pictures that load as they come near; the first screen is about 280 kB: the HTML, the stylesheet, two fonts the app shares and one phone screenshot (`fetchpriority="high"`). The largest paint is the printed word, under a second on a phone with slow 4G and a 4× slower CPU. Keep pictures in AVIF with widths that match how they show, and lazy below the fold.

## Tests

`e2e/landing.spec.ts`: a visitor sees the page and Sign in leads to signing in; signed in, `/` is the app with no landing file loaded; deep links still go to sign-in and back. `e2e/offline.spec.ts` checks the same with the service worker installed. `e2e/first-load.spec.ts` keeps the app's first loads within their ceilings.
