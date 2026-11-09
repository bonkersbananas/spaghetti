# Spaghetti design language

Spaghetti is a kitchen notebook for 3D printing: warm, calm and tactile, with a little pasta humor. It should feel as considered as Things 3 or Linear, and warmer than either. This document is the rulebook; `/styleguide` in the app shows all of it, live.

The tokens live in [`src/client/styles/tokens.css`](../src/client/styles/tokens.css). The shared components live in [`src/client/components/ui`](../src/client/components/ui). Build screens from these two and nothing else.

## Principles

1. **Capture in under 10 seconds.** From any screen, a photo or note is one tap (the tab bar's tomato button) or one key (`C`) away. Titles are optional everywhere.
2. **Photos first.** Prints are physical. Cards lead with the picture; text supports it.
3. **Instant.** Every tap answers within 100 ms: optimistic updates through TanStack Query, skeletons while loading, never a full-page spinner.
4. **The phone is not a shrunken desktop.** Phones get a tab bar, bottom sheets and big thumb targets. Desktop gets a sidebar, keyboard shortcuts and columns.
5. **Calm, warm, tactile.** Paper and cream surfaces, soft shadows instead of borders, generous space, a gentle press on everything you tap.
6. **Playful in small doses.** Pasta lives in empty states, names and one or two moments of delight. Never in the way of reading or logging.
7. **Never lose work.** Autosave everything. Deletes happen immediately and offer Undo in a toast; there are no "are you sure?" dialogs.

## Color

Use the semantic tokens as Tailwind classes (`bg-paper`, `text-ink-soft`, `fill-tomato`…). Tailwind's default palette is switched off, and `pnpm lint` rejects color literals in components.

| Token                                          | Use                                                                                                |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `paper`                                        | The page background.                                                                               |
| `paper-deep`                                   | The desktop sidebar, recessed areas.                                                               |
| `cream`                                        | Anything raised: cards, sheets, the tab bar.                                                       |
| `lifted`                                       | Sheets, dialogs and menus. The same as `cream` by day, a step lighter at night.                    |
| `well`                                         | Photo placeholders, skeletons. Fields use `bg-ink/4`, which reads as a well on paper and on cream. |
| `veil` / `veil-strong` / `on-veil`             | Badges and buttons drawn over photos: dark glass, cream text, in both themes.                      |
| `select` / `on-select`, `toast` / `toast-fg`   | A selected chip; toasts. Both invert the page by day and settle into surfaces at night.            |
| `ink` / `ink-soft` / `ink-faint` / `ink-ghost` | Headings and text / body and labels / meta and hints (AA on paper) / placeholders and disabled.    |
| `tomato`                                       | The one action color: one primary (tomato) button per screen. Also errors. Never focus.                 |
| `basil`                                        | Success: a print that worked, "Saved".                                                             |
| `semolina`                                     | Highlight and in-progress: printing now, selections.                                               |
| `*-soft` / `*-ink`                             | Background and text pairs for chips and quiet states (`bg-basil-soft text-basil-ink`).             |
| `person-*`                                     | Each person's color (tomato, basil, semolina, plum, sea, clay), for avatars and authorship.        |

Accents are spice, not sauce: most of a screen is paper, cream and ink.

### Dark mode

Light, dark or system, chosen in the account sheet (phone) or the sidebar's account menu (desktop) and remembered per device (`localStorage`, key `sg-theme`). `lib/theme.ts` puts the result on `<html data-theme>`; a tiny inline script in `index.html` does the same before the first paint, so there is no flash. Everything is built on tokens, so a new component gets a dark mode for free: check it in both with the switch on `/styleguide`.

The night version is the same kitchen notebook with the lights down:

- **Surfaces are warm browns**, never black or grey: paper `#1b1714`, cards `cream` a step lighter, sheets and menus (`lifted`) another step. `well` and `paper-deep` go darker, because they are recessed.
- **Ink is soft cream**, not white (`#ece4d9`), with the same four steps.
- **Accents keep their hue and lose the glow.** Tomato stays the deep daytime tomato on fills (cream text on it is AA); only text and icons on dark surfaces use the lighter `tomato-ink`. Basil and semolina are a touch deeper; their `-soft` and `-ink` pairs are swapped for dark backgrounds with light text.
- **Elevation is lifting, not shadow.** Shadows barely show on dark, so cards, buttons and sheets get a lighter surface and a faint lit top edge (an inset highlight in `shadow-soft`/`raised`/`float`); hovered cards use `bg-lifted`.
- **Things over photos** (count badges, upload badges, remove buttons) use `veil` / `on-veil`: dark glass with cream text in both themes, because a photo is the same photo at night. Photos sit on a dark frame, never a glaring one.
- **Toasts** are dark chips by day and a lifted surface at night (`toast` / `toast-fg`), so they don't glow. A **selected chip** is `select` / `on-select`.
- **The app mark** (`mark-tile`, `mark-stroke`) never changes: it is an icon. Illustration ground shadows use `shade`.
- **Outside the page:** the `theme-color` meta follows the theme (browser toolbar and Android status bar), and the `<link rel="manifest">` switches to `manifest-dark.webmanifest` (same icons, dark `background_color` for the splash) when the app is dark. iOS draws a standalone app's status bar from the system appearance, not from the page, so an app theme that differs from the system one can show a mismatched bar there.

### Contrast

WCAG AA: 4.5:1 for text, and the same for the initials on avatars; 3:1 for icons and large UI. Every pair the app uses is listed in `scripts/lib/contrast.ts`, measured against the real token values, and `test/unit/contrast.test.ts` fails if any drops below AA in either theme. `node scripts/lib/contrast.ts` prints the table below. `ink-ghost` is for disabled controls and decoration only, never for text people must read (placeholders use `ink-faint`).

| Pair | Needs | Light | Dark |
| --- | --- | --- | --- |
| Body text | 4.5:1 | 13.6 | 14.1 |
| Body text on cards | 4.5:1 | 14.9 | 12.8 |
| Body text on sheets | 4.5:1 | 14.9 | 11.5 |
| Labels and body copy | 4.5:1 | 6.6 | 9.4 |
| Labels on cards | 4.5:1 | 7.2 | 8.5 |
| Meta and hints | 4.5:1 | 5.1 | 6.0 |
| Meta on cards | 4.5:1 | 5.6 | 5.4 |
| Meta on sheets | 4.5:1 | 5.6 | 4.9 |
| Meta on the sidebar | 4.5:1 | 4.7 | 6.3 |
| Text typed in a field | 4.5:1 | 13.8 | 11.6 |
| Placeholder in a field | 4.5:1 | 5.2 | 4.9 |
| Error text | 4.5:1 | 5.7 | 8.3 |
| Error text on cards | 4.5:1 | 6.3 | 7.5 |
| Active tab label | 4.5:1 | 6.3 | 7.5 |
| Tomato chip | 4.5:1 | 5.2 | 6.9 |
| Basil chip | 4.5:1 | 5.0 | 7.3 |
| Semolina chip | 4.5:1 | 5.0 | 8.4 |
| Neutral chip | 4.5:1 | 5.9 | 8.2 |
| Selected chip | 4.5:1 | 13.6 | 11.4 |
| Search match | 4.5:1 | 12.4 | 10.4 |
| Primary button | 4.5:1 | 4.6 | 4.6 |
| Primary button, hovered | 4.5:1 | 5.8 | 5.8 |
| Badge over a white photo | 4.5:1 | 4.6 | 4.6 |
| Toast | 4.5:1 | 13.6 | 10.0 |
| Initials on tomato avatar | 4.5:1 | 4.6 | 4.6 |
| Initials on basil avatar | 4.5:1 | 5.8 | 5.8 |
| Initials on semolina avatar | 4.5:1 | 4.5 | 4.5 |
| Initials on plum avatar | 4.5:1 | 5.1 | 5.1 |
| Initials on sea avatar | 4.5:1 | 5.0 | 5.0 |
| Initials on clay avatar | 4.5:1 | 5.2 | 5.2 |
| Active icon (tomato) on the sidebar | 3:1 | 3.9 | 3.9 |
| Basil icon on cards | 3:1 | 5.9 | 5.3 |

Badges over photos are measured against a white photo, the worst case.

## Type

- **Fraunces** (variable, with the `SOFT` axis at 100) for headings: `h1`–`h3` get it automatically, or use `font-display`.
- **Figtree** (variable) for everything people read and tap.
- Both are self-hosted through Fontsource.

The scale has one set of names and two sets of sizes: phones read slightly larger (body 16 px) than desktop (body 15 px), switching at the `md` breakpoint.

| Class           | Phone | Desktop | Use                                                  |
| --------------- | ----- | ------- | ---------------------------------------------------- |
| `text-display`  | 36    | 44      | Page titles                                          |
| `text-headline` | 28    | 30      | Section and empty-state titles                       |
| `text-title`    | 20    | 20      | Sheet titles, card titles in detail                  |
| `text-lead`     | 18    | 17      | Intros, writing surfaces on phones                   |
| `text-body`     | 16    | 15      | Default                                              |
| `text-small`    | 14    | 13      | Labels, meta, chips                                  |
| `text-caption`  | 12    | 12      | Tab labels, overlines (uppercase + `tracking-wider`) |

Use `tabular` for numbers that line up (temperatures, durations, weights).

## Space, layout and radii

- Spacing is Tailwind's 4 px scale. Prefer generous space to dividers.
- Phone pages: `px-5`, content clears the tab bar with `pb-tabbar`; the shell handles safe-area insets (`pt-safe`, `pb-safe`).
- Desktop: the sidebar is `w-sidebar` (16 rem); content sits in `max-w-wide` (72 rem) with `px-12`. A page with a single column of content (header text, fields, empty states) keeps it in one left-aligned `max-w-content` (45 rem) column, and empty states center within that column, not across the main area.
- Radii: `rounded-xs` (6) for keys and tiny bits, `sm` (10) for small buttons and nav items, `md` (14) for buttons and fields, `lg` (20) for cards and tiles, `xl` (28) for sheets and big panels, `rounded-pill` / `rounded-full` for chips and avatars. Bigger things get softer corners.

## Elevation

Surfaces are separated by soft, warm shadows, not borders.

| Class           | Use                                          |
| --------------- | -------------------------------------------- |
| `shadow-well`   | Inset: fields, photo tiles, wells.           |
| `shadow-soft`   | Cards and secondary buttons at rest.         |
| `shadow-raised` | Hover, the sign-in card, the capture button. |
| `shadow-float`  | Sheets, dialogs, toasts.                     |

In dark mode the same classes lift instead: a lighter surface and a faint lit top edge, not a darker shadow.
| `shadow-bar`    | The phone tab bar (casts upward).            |

A hairline (`bg-hairline`) is allowed only where a shadow can't work, such as between rows inside one surface.

## Motion

- Durations: `duration-instant` (90 ms, press), `duration-fast` (160 ms, hover and fades), `duration-base` (240 ms, sheets in), `duration-slow` (420 ms, entrances). Easing: `ease-out` for things arriving, `ease-in-out` for things leaving or looping.
- In JS (`motion`), use `src/client/lib/motion.ts`: the same durations and easings, plus springs for things under a finger.
- Everything tappable gets `pressable`: it shrinks to 97% while held.
- Focus: `focus-ring` / `shadow-ring`, a calm ink ring (never tomato, which means action or error). Fields keep their fill when focused; a field with an error uses `shadow-ring-error`.
- `prefers-reduced-motion` is respected globally (CSS) and by `<MotionConfig reducedMotion="user">`. Never rely on motion to convey meaning.
- Motion never delays content: no entrance animation longer than `slow`, nothing on scroll.

## Icons

One family: [Phosphor](https://phosphoricons.com). Import from `@/components/ui/icons` only (Biome enforces it), which re-exports the icons we use under app names (`IdeasIcon`, `CameraIcon`…). Add new ones there. Regular weight at 20 px by default, `fill` for an active tab or nav item, `bold` inside small buttons.

## Components

All in `src/client/components/ui`, all shown in `/styleguide`.

- **Button** — `primary` (tomato, one per screen), `secondary` (cream, soft shadow), `quiet` (toolbars, lists), `danger` (soft tomato). Sizes `sm`/`md`/`lg`; phone targets are at least 44 px. Optional `icon`, `shortcut` (keyboard hint, desktop only) and `loading`. **IconButton** needs a `label`.
- **TextField / TextArea** — built for autosave: pass `saveState` to show "Saving… / Saved" beside the label instead of a save button. `appearance="plain"` for writing surfaces that read as text. TextArea grows with its content.
- **SaveStatus** — the quiet autosave indicator on its own.
- **Sheet** — the one overlay. A bottom sheet (vaul) on phones; on desktop a centered `dialog` (quick tasks like capture) or a right `panel` (detail views).
- **Toast** — `toast.undo(message, { onUndo })` after any delete. Also `toast.success`, `toast.error`, `toast.message`, `toast.action` (one button, such as "View") and `toast.delight` (a sparkle, for the rare moment worth celebrating). Phones show toasts above the tab bar.
- **EmptyState** — illustration, a title with a small pasta joke, one plain sentence on what goes here, one next step. It fills the page's `max-w-content` column. On desktop its button is `secondary` when the sidebar's "New idea" is already the screen's primary action; phones keep it primary.
- **Card** — photo first, optional title (the note stands in), chips over the photo, a `badge` top right (`PhotoCountBadge`), meta line, author avatar. Without a photo it is a **note card**: the note sits on paper where the photo would be, in the same grid. Pass `link` to make it a router link. Grids of prints use `aspect="portrait"` (4:5).
- **Photo** — a framed image that shows the photo's own average color while it loads, then fades in. `fit="contain"` in viewers (never crop a print people look at closely), `cover` in grids.
- **UploadBadge / ProgressRing** — on a photo still on its way to the server: "Saving 42%" with a ring, or "Not saved yet" (semolina, not tomato: it retries on its own).
- **PhotoThumb / AddPhotoTile** — square thumbnails with a remove button, and the wells to tap for more photos (`lg` when there are none yet, `md` and `sm` at the end of a row, `card` to fill a 4:5 grid cell, `row` for a full-width strip). `useFilePicker` gives the hidden input: `camera` opens the camera directly on phones.
- **NoteField** — a note that reads as text with clickable links and becomes a growing textarea when tapped. TextArea also has `appearance="title"` for an editable heading.
- **Chip / ToggleChip** — status and material labels in four tones; ToggleChip for filters, and with a `tone` for tags (a picked failure tag in tomato, a success note in basil).
- **SegmentedControl** — two to four choices side by side (main or auxiliary nozzle, no / normal / tree supports, where a capture goes). Arrow keys move between segments.
- **NumberField / DurationField** — numbers with their unit inside the field (`suffix="°C"`), typed freely and kept as numbers; durations typed the way people say them ("2h 10", "2:10", "130") and shown as "2 h 10 min". TextField takes `size="sm"` for dense groups such as print settings.
- **Swatch / SwatchPicker** — a filament's color as a round chip, and a 44 px well that opens the device's color picker with common filament colors first. The color is data, so it is the one inline style allowed.
- **Disclosure** — optional detail behind one tap, with a one-line summary while closed (an attempt's settings).
- **ActionBar** — a screen's main action within thumb reach on phones, sitting on the tab bar ("Log attempt", "Start building"). Hidden on desktop, where the action lives in the page. Toasts move up above it while it shows.
- **ChipRow / ChipDivider / FilterGroup** — rows of filter or suggestion chips: on phones a row scrolls sideways edge to edge (with a thin divider between kinds of chips), on desktop it wraps. `FilterGroup` is one kind of filter in a desktop filter column, a caption over its chips.
- **MetaList** — a line of short pieces with a dot between them ("Black PETG · 0.20 mm · Cool Plate"): settings lines, "attempt 3 · 2 h ago", what changed. It wraps cleanly: a dot never begins or ends a line (each piece carries its dot in a gutter the row clips). Use it for every dot-separated line; `SettingsLine` is built on it.
- **Highlight** — text with the words a search matched on a semolina highlight, like a pen stroke. A tag chip that matched gets a ring instead.
- **Avatar / AvatarStack** — initials on the person's color.
- **Skeleton / CardSkeleton / RowSkeleton** — loading states shaped like the content.
- **Kbd** — keyboard hints, hidden on phones.
- **SegmentedControl** — pick one of a few short options (appearance: light, dark, system): a recessed channel with a lifted thumb, real radio inputs underneath. `ThemeSwitch` (shell) is the appearance one.
- **Popover** — a small floating panel for desktop menus, such as the sidebar's account menu. Tasks use Sheet.
- **OfflineNotice** (shell) — a quiet strip at the top of the page while the server can't be reached, with how many captures are waiting. The only place the app complains about the connection.
- **Illustrations** (`components/illustrations`) — 160×120 spot illustrations: ink outlines at 2.5 px, round caps, one tinted circle behind, one or two accent fills. The `Mark` is the app icon: a twirl of spaghetti on a tomato tile.

## App shell

- **Phone (< 768 px):** a page header with a large title and the account avatar; a bottom tab bar (Ideas, Builds, capture, Journal, Search) with the capture button in the middle.
- **Desktop:** a fixed left sidebar on `paper-deep` with the mark, a "New idea" button, the four sections with keyboard hints, the styleguide and the signed-in person.
- **Keyboard (desktop):** `C` capture, `G I` Ideas, `G B` Builds, `G J` Journal, `/` Search. Shortcuts are ignored while typing or while a sheet is open.
- **Capture from anywhere (desktop):** paste an image (or a link) when not typing, or drop photos anywhere on the window (a "Drop to capture" overlay shows while dragging). In the capture note, `Enter` saves and `Shift+Enter` is a new line; `Escape` closes and keeps the draft.
- **Detail screens:** phones get a full page with a sticky back bar; desktop puts the photos beside the text. `Escape` goes back, arrow keys move between photos, `Backspace`/`Delete` deletes with undo.

## Ideas

- **Capture** saves at once: the sheet closes, the idea lands at the top of the inbox (with a small spring) and its photos upload in the background with progress on the card. Nothing waits on the network.
- **The inbox** is a grid of 4:5 cards, newest first: two columns on phones, three, then four on desktop. Text-only ideas are note cards in the same grid. The author is a small avatar, the time is relative ("2 h ago").
- **Delight**, in small doses: the first idea ever gets a "First one in the pot" toast, once per device; new cards land with a quick spring.

## Builds and attempts

- **One record, many stages.** An idea becomes a build in one tap ("Start building", `B` on desktop) and keeps its photos and notes; it lives under Builds from then on. A build can also start from scratch.
- **The builds list** puts what's on the bed first, printing before the rest, each card with its newest photo and how the last attempt went (an outcome chip over the photo). Done and shelved builds sit below as quieter rows.
- **A build** leads with its best photo (the final print once done), then its story: attempts newest first, each on a thread whose dot is the outcome's color. Each attempt says what changed since the one before ("bed 55 → 60 °C", "added a brim") on a semolina highlight: this is how the app answers "what worked". A "What worked" card repeats the latest attempt that came out right. Desktop puts the build and the story side by side; `A` logs an attempt (or finishes the one printing), arrow keys or `J`/`K` move through attempts, `Enter` opens one.
- **Plates** are named the way people say them: "Textured PEI" and "Smooth PEI", but "Cool Plate", "Engineering Plate", "High Temp Plate" in full (a bare "Cool" reads as a temperature). `plateName` in `shared/attempts.ts`.
- **Outcomes** are Worked (basil), Partly (semolina) and Spaghetti (tomato, soft): a failure is not an error. Printing is semolina with a gentle pulse.
- **The attempt sheet** (bottom sheet on phones, right panel on desktop) asks only for the outcome, in three big buttons; the time is now. Photos, a one-line note, failure tags (when it didn't work), success notes (when it did) and settings are one tap away. A new attempt starts from the attempt before's settings, so people change only what they try differently. "Still printing" saves it now to finish later.
- **Finishing** a build is one action, with undo; it picks the final photo (the newest photo of the last attempt that worked). A build that had spaghetti gets the one delight toast, "Al dente", with a sparkle on the Done chip.
- **Capture follows its context**: on an idea's or a build's page it adds there (photos join it, the note goes into its notes); while something prints it adds to that print and can finish it. "New idea" is always one tap away in the sheet.

## Journal

- **Everything that happened, newest first:** print attempts as photo-led cards, and quieter rows for ideas captured and builds started, finished (a bigger photo, in basil) or shelved. A spaghetti attempt is the same card as a success: its outcome chip over the photo and its failure tags in plain view.
- **Grouping:** months, each with a quiet heading that sums it up in one line ("9 prints, 3 spaghetti, headphone stand finished"), the journal's one moment of delight. Inside a month, the last seven days get day headings ("Today", "Thursday"); further back, quieter week headings.
- **Filters are chips kept in the URL** (`/journal?outcome=failures&material=PETG&person=sam`), so a filtered journal can be bookmarked. "Only failures" (spaghetti and partly) comes first: a wall of lessons. Outcome and material show only attempts.
- **Phone:** one column of big entries; the filters are a row that scrolls sideways. **Desktop:** the feed with a sticky filter column on the right (from 1280 px; a chip row below that). `J` and `K` move through entries, `Enter` opens one (an attempt opens its build with that attempt picked).
- Pages of 30 load before the end comes into view, and months far off screen skip layout (`render-lazy`), so a year of prints stays fast.

## Search

- **One box finds everything:** ideas, builds and attempts by title, notes, failure tags and success notes, filament type, brand and color, plate, profile and supports. Every word must match, each as the start of a word ("pet warp"); short material names (PLA, PA, PC, ABS) match whole words only.
- **As you type:** results follow the box after a short pause and the last results stay on screen, dimmed, until the next arrive. Never a spinner page. Results come grouped (builds, attempts, ideas), photo first, matched words highlighted.
- **Before typing:** recent searches on this device and the tags and materials used most. Filter chips (outcome, material, tag, person) narrow results, and work without words too.
- **Keyboard:** `/` focuses the box from anywhere, arrow keys move through results, `Enter` opens. On phones the Search tab opens with the keyboard up.

## What worked last time

The attempt sheet offers the best match from history above the settings: the latest attempt that worked with the same material (the build's own first), with its photo, key settings and what would change, and **Use these settings** to start from them in one tap (with Undo). The spool stays the one already chosen; only the plate, temperatures and the rest change. It stays out of the way when nothing matches, or when the attempt already starts from those settings.

## Voice

Short, warm, plain. Second person, sentence case, no exclamation marks. A pasta joke is welcome in an empty-state title or a toast, once per screen at most ("Nothing simmering yet", "Nothing on the bed"); the sentence after it says plainly what to do. Failures are not errors: a failed print is "spaghetti", recorded with the same care as a success.

## Rules for new UI

1. Use tokens and shared components only. No hex colors, no `text-[13px]`, no one-off shadows: `pnpm lint` checks (`scripts/check-design.ts`).
2. If a screen needs something the system lacks, add it to the system (a token or a component in `components/ui`), document it here, and show it in `/styleguide`.
3. Design both layouts: check every screen at 390 px and 1440 px with `pnpm screenshots`, and look at the result before calling it done.
4. Loading is a skeleton, saving is automatic, deleting is undoable.

## Offline

Spaghetti opens and captures without a connection. The build ships a small hand-written service worker (`src/sw/sw.js`, assembled by `scripts/vite-service-worker.ts`; `vite dev` has none):

- It **precaches the app shell**: `index.html`, scripts, styles, fonts, icons and both manifests, versioned by a hash of the build. The app opens instantly, with or without signal.
- **`/api` is never cached**, except photos (`/api/photos/:id/thumb|large`, which never change once saved): photos already seen show offline. Everything else goes to the network every time, so nobody sees another person's stale edits as current. Offline, the inbox says the pot is out of reach rather than showing old data. Signing out clears the photo cache.
- **Captures** keep working: the app opens as the person last signed in (remembered locally; the server checks again as soon as it can, and a 401 signs out), a capture goes into the IndexedDB outbox, and it is sent when the connection is back. The `OfflineNotice` is the one place that says so; `lib/connection.ts` decides (the browser's `online` flag, failed requests, and a quiet `/api/health` probe).
- **Updates** install in the background. A quiet "A new version is ready" toast offers Refresh; otherwise the new version takes over after every tab has been closed. Nothing captured is lost either way.
- **Install:** `manifest.webmanifest` (`id`, standalone, any and maskable icons) and `manifest-dark.webmanifest`, which the page swaps in when dark so a dark install gets a dark splash.
