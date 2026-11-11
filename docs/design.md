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
| `note`                                         | A note card's face: paper by day, a step lifted at night, like an index card under the lamp.       |
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
| A note on a note card | 4.5:1 | 13.6 | 11.5 |
| Labels and body copy | 4.5:1 | 6.6 | 9.4 |
| Labels on cards | 4.5:1 | 7.2 | 8.5 |
| Meta and hints | 4.5:1 | 5.1 | 6.9 |
| Meta on cards | 4.5:1 | 5.6 | 6.2 |
| Meta on sheets | 4.5:1 | 5.6 | 5.6 |
| Meta on the sidebar | 4.5:1 | 4.7 | 7.2 |
| Text typed in a field | 4.5:1 | 13.8 | 11.6 |
| Placeholder in a field | 4.5:1 | 5.2 | 5.6 |
| Placeholder in a field on a sheet | 4.5:1 | 5.2 | 5.0 |
| Hint in a hovered well on a sheet | 4.5:1 | 5.0 | 4.8 |
| Error text | 4.5:1 | 5.7 | 8.3 |
| Error text on cards | 4.5:1 | 6.3 | 7.5 |
| Printer check | 4.5:1 | 5.5 | 11.4 |
| Printer check on cards | 4.5:1 | 6.0 | 10.3 |
| Printer check on sheets | 4.5:1 | 6.0 | 9.3 |
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
| Print progress label | 4.5:1 | 7.2 | 8.5 |
| Print progress label, due | 4.5:1 | 6.0 | 10.3 |
| Print progress label on paper, due | 4.5:1 | 5.5 | 11.4 |
| A changed value in the compare sheet | 4.5:1 | 13.1 | 10.8 |
| Same-in-both settings, opened, on a sheet | 4.5:1 | 6.8 | 7.1 |
| Column names and labels in the compare sheet | 4.5:1 | 5.6 | 5.6 |
| A link card's letter tile | 4.5:1 | 6.6 | 7.5 |
| Attempt count on the outcome strip | 4.5:1 | 5.6 | 6.2 |

Badges over photos are measured against a white photo, the worst case. The decorative rim on a spool (below) is the one thing that does not reach 3:1, by design: ink at 35% on a card measures 2.1:1 in light and 2.8:1 in dark (the old 15% rim measured 1.3 and 1.5). A spool's name is always written beside it, so the rim only has to make the disc easy to find, not carry meaning.

## Type

- **A monospace** (`font-mono`, the system's) only for things people copy character by character: API tokens and their prefixes.
- **Fraunces** (variable, with the `SOFT` axis at 100) for headings: `h1`–`h3` get it automatically, or use `font-display`.
- **Figtree** (variable) for everything people read and tap.
- Both are self-hosted through Fontsource.

The scale has one set of names and two sets of sizes: phones read slightly larger (body 16 px) than desktop (body 15 px), switching at the `md` breakpoint.

| Class           | Phone | Desktop | Use                                                  |
| --------------- | ----- | ------- | ---------------------------------------------------- |
| `text-display`  | 36    | 44      | Page titles                                          |
| `text-figure`   | 56    | 96      | A few large figures on the Year so far (display face) |
| `text-headline` | 28    | 30      | Section and empty-state titles                       |
| `text-title`    | 20    | 20      | Sheet titles, card titles in detail                  |
| `text-lead`     | 18    | 17      | Intros, writing surfaces on phones                   |
| `text-body`     | 16    | 15      | Default                                              |
| `text-small`    | 14    | 13      | Labels, meta, chips                                  |
| `text-caption`  | 12    | 12      | Tab labels, overlines (uppercase + `tracking-wider`) |
| `text-micro`    | 11    | 11      | Two initials in the 24 px avatar (xs); nothing else  |

Use `tabular` for numbers that line up (temperatures, durations, weights).

## Space, layout and radii

- Spacing is Tailwind's 4 px scale. Prefer generous space to dividers.
- Phone pages: `px-5`, content clears the tab bar with `pb-page`; the shell handles safe-area insets (`pt-safe`, `pb-safe`). Read the insets only through `--sg-safe-top` / `--sg-safe-bottom` (never `env()` in a component): tests and `pnpm screenshots --iphone` override them. `--sg-tabbar-height` is the whole tab bar, home indicator included: floating bottom actions sit at `bottom-tabbar` (use `ActionBar`), and nothing is placed with its own number. A frosted strip belongs only over the status bar (`StatusBarCap`, clear until the page scrolls), never over a page title.
- Desktop: the sidebar is `w-sidebar` (16 rem); content sits in `max-w-wide` (72 rem) with `px-12`. A page with a single column of content (header text, fields, empty states) keeps it in one left-aligned `max-w-content` (45 rem) column, and empty states center within that column, not across the main area.
- Touch targets: at least 44 px on phones. Controls drawn smaller (`Button`/`IconButton` `sm`, chips, a thumbnail's remove button, a toast's action) get `touch-target`, an invisible 44 px hit area on touch screens that doesn't change how they look.
- Phone sheets sit on the on-screen keyboard: `lib/viewport.ts` keeps `--sg-keyboard-inset` and `--sg-visible-height` from `visualViewport` (iOS Safari doesn't shrink `100dvh` for the keyboard), so a sheet's footer button stays in view while typing. Fields are 16 px or more on phones (`text-body`), or iOS Safari zooms in.
- Radii: `rounded-xs` (6) for keys and tiny bits, `sm` (10) for small buttons and nav items, `md` (14) for buttons and fields, `lg` (20) for cards and tiles, `xl` (28) for sheets and big panels, `rounded-pill` / `rounded-full` for chips and avatars. Bigger things get softer corners.

## Elevation

Surfaces are separated by soft, warm shadows, not borders.

| Class           | Use                                          |
| --------------- | -------------------------------------------- |
| `shadow-well`   | Inset: fields, photo tiles, wells.           |
| `shadow-soft`   | Cards and secondary buttons at rest.         |
| `shadow-raised` | Hover, the sign-in card, the capture button. |
| `shadow-float`  | Sheets, dialogs, toasts.                     |
| `shadow-bar`    | The phone tab bar (casts upward).            |

In dark mode the same classes lift instead: a lighter surface and a faint lit top edge, not a darker shadow.

A hairline (`bg-hairline`) is allowed only where a shadow can't work, such as between rows inside one surface.

## Motion

- Durations: `duration-instant` (90 ms, press), `duration-fast` (160 ms, hover and fades), `duration-base` (240 ms, sheets in), `duration-slow` (420 ms, entrances). Easing: `ease-out` for things arriving, `ease-in-out` for things leaving or looping.
- In JS (`motion`), use `src/client/lib/motion.ts`: the same durations and easings, plus springs for things under a finger.
- Everything tappable answers the touch within one frame. `pressable` shrinks to 97% and tints while held (`duration-instant`): filled tomato controls (`press-tomato`: the primary and capture buttons) deepen to `tomato-pressed`, everything else takes `--sg-press-veil` (8% of the control's own text colour over its own surface, so a selected or toned chip keeps its tone and contrast; the pairs are in `scripts/lib/contrast.ts`), and the tab bar items (`press-none`) get a round `pressed` highlight behind the icon, and anything tappable without it (inline links, plain rows) dims to `--sg-press-dim` (60%) by a base rule in `app.css`, so no tap is silent; `data-pressed` shows either state at rest (the styleguide's Motion section; a held state is transient, so axe skips `[data-pressed]`). Tappable things also get `touch-action: manipulation` from the same base rule: no double-tap-to-zoom wait.
- `motion` is loaded lazily: components use `m.div` (not `motion.div`) inside the root's `<LazyMotion>`, so its animation code arrives just after the first screen.
- JS scrolling (`scrollTo`, `scrollIntoView`) passes `behavior: scrollBehavior()` from `lib/motion.ts`, never `"smooth"`: an explicit smooth scroll ignores the reduced-motion CSS.
- Focus: `focus-ring` / `shadow-ring`, a calm ink ring (never tomato, which means action or error). Fields keep their fill when focused; a field with an error uses `shadow-ring-error`.
- `prefers-reduced-motion` is respected globally (CSS) and by `<MotionConfig reducedMotion="user">`. Never rely on motion to convey meaning.
- Motion never delays content: no entrance animation longer than `slow`, nothing on scroll.
- **A photo travels from its card to its page** (View Transitions, through the router's `viewTransition` on the links of `Card`, journal entries and search results; no polyfill, and browsers without the API just change page). Only one element may carry the transition name `hero-photo` at a time, because duplicate names cancel the whole transition and the journal can show one photo twice: so the name is not on every card but put, on tap, on the tapped card's photo frame (`heroClick`, `lib/hero.ts`), and the page it opens gives the same name to its hero photo while that is the same photo (`useHeroName`); both let go 800 ms later. When the hero is a different photo (a build card shows its newest photo, the page leads with the best), nothing is named and the page crossfades. `app.css` times the moving group at `--sg-duration-base` with `--sg-ease-out` and the rest of the page at `--sg-duration-fast`; with reduced motion every view-transition animation is `none`.
- **An outcome answers the tap**: the picked icon in `OutcomePicker` springs from 0.8 to 1 (`spring.snappy`), only for a pick made there, and on phones that can vibrate `tap()` (`lib/haptics.ts`) gives a 10 ms buzz, never with reduced motion.
- **Today reflows when a print gets its answer** (`routes/_app/today.tsx`): the card that leaves fades while its height collapses over `duration-base` (with its gap, which is its own padding), so the cards under it rise with it; on phones the next print, compact until now, becomes the big card: `AutoHeight` (`ui/AutoHeight.tsx`) grows its box by its real height on `spring.gentle` (no scaling, clipped only while it moves; it animates only when its `trigger` changes and is plain `height: auto` otherwise, so heights that settle as the page loads never move it) while the big layout fades in over `duration-base`. Its build arrives under "Pick up again" with a fade, the rows making room on `spring.gentle`. With reduced motion all of it is at its end state at once (`useReducedMotion`: `MotionConfig` stops transforms but not heights or fades).
- **Stepping between attempts**: with a saved attempt open and more than one in the build, the attempt sheet's header has "Previous attempt" and "Next attempt" (`IconButton size="sm"`, disabled at the ends; not while logging a new attempt). The frame (title, arrows, footer) stays put and the body crossfades over `duration-fast` (none with reduced motion); the attempt left autosaves as it unmounts, so stepping away mid-edit is safe. `Sheet` takes `headerActions` for this.

## Icons

One family: [Phosphor](https://phosphoricons.com). Import from `@/components/ui/icons` only (Biome enforces it), which re-exports the icons we use under app names (`IdeasIcon`, `CameraIcon`…). Add new ones there. Regular weight at 20 px by default, `fill` for an active tab or nav item, `bold` inside small buttons.

## Components

All in `src/client/components/ui`, all shown in `/styleguide`.

- **Button** — `primary` (tomato, one per screen), `secondary` (cream, soft shadow), `quiet` (toolbars, lists), `danger` (soft tomato). Sizes `sm`/`md`/`lg`; phone targets are at least 44 px. Optional `icon`, `shortcut` (keyboard hint, desktop only) and `loading`. **IconButton** needs a `label`.
- **TextField / TextArea** — built for autosave: pass `saveState` to show "Saving… / Saved" beside the label instead of a save button. `appearance="plain"` for writing surfaces that read as text. TextArea grows with its content.
- **SaveStatus** — the quiet autosave indicator on its own.
- **Sheet** — the one overlay. A bottom sheet (vaul) on phones; on desktop a centered `dialog` (quick tasks like capture) or a right `panel` (detail views). Focus moves into it when it opens, stays there, and goes back to what opened it when it closes, also when it was opened from a shortcut or the palette. `wide` makes the desktop dialog `max-w-4xl` for content in columns, and `tall` makes the phone sheet as tall as a sheet gets instead of as tall as its content (both used by the compare sheet).
- **Toast** — `toast.undo(message, { onUndo })` after any delete. Also `toast.success`, `toast.error`, `toast.message`, `toast.action` (one button, such as "View") and `toast.delight` (a sparkle, for the rare moment worth celebrating). Phones show toasts above the tab bar.
- **EmptyState** — illustration, a title with a small pasta joke, one plain sentence on what goes here, one next step. It fills the page's `max-w-content` column. On desktop its button is `secondary` when the sidebar's "New idea" is already the screen's primary action; phones keep it primary. On Today it is `secondary` at every width, because the tab bar's capture button (and the sidebar's "New idea") is already the primary action.
- **Card** — photo first, optional title (the note stands in), chips over the photo, a `badge` top right (`PhotoCountBadge`), meta line, author avatar. Without a photo it is a **note card** (`NoteFace`): the note fills the picture's place like a line on an index card, in the same grid. Pass `link` to make it a router link. Grids of prints use `aspect="portrait"` (4:5).
- **NoteFace** — a note in place of a photo: Fraunces under one faint tomato rule, on `bg-note` with the paper grain. It is set by length (`noteSize`): `xl` up to about 32 letters, `lg` up to 72, `md` up to 130, `sm` beyond, one step smaller when a word is too long for the line. The sizes (`text-note-*`) and margins (`p-note-inset`) are in container units, a share of the card's width, so a note wraps the same in two columns on a phone and four on desktop; the two smaller steps never go below 16 and 15 px. A note too long for its card fades out at the bottom (`fade-bottom`).
- **Photo** — a framed image that shows the photo's own average color while it loads, then fades in. `fit="contain"` in viewers (never crop a print people look at closely), `cover` in grids. `frame="deep"` sets it on the deeper `paper-deep` of a viewer instead of `well`, for photos that are shown whole.
- **UploadBadge / ProgressRing** — on a photo still on its way to the server: "Saving 42%" with a ring, or "Not saved yet" (semolina, not tomato: it retries on its own). `ProgressRing` (`ui/ProgressRing.tsx`) is the shared ring, 16 px by default and resized with a `size-*` class; `PrintProgress` reuses it.
- **PhotoThumb / AddPhotoTile** — square thumbnails with a remove button, and the wells to tap for more photos (`lg` when there are none yet, `md` and `sm` at the end of a row, `card` to fill a 4:5 grid cell, `row` for a full-width strip). `useFilePicker` gives the hidden input: `camera` opens the camera directly on phones. A `PhotoThumb` with `onSelect` is a button that picks it (with `selected` for the one showing), as in the compare sheet.
- **NoteField** — a note that reads as text with clickable links and becomes a growing textarea when tapped. TextArea also has `appearance="title"` for an editable heading.
- **Stepper** — a count to nudge (minus, the number, plus) in a `rounded-pill` well: 44 px buttons on phones, compact on desktop, and the number answers the arrow keys (`role="spinbutton"`). Quantities of parts and the pieces that came out.
- **Chip / ToggleChip** — status and material labels in four tones; ToggleChip for filters, and with a `tone` for tags (a picked failure tag in tomato, a success note in basil).
- **SegmentedControl** — two to four short choices side by side (main or auxiliary nozzle, a nozzle's size, no / normal / tree supports, where a capture goes, light / dark / system): a recessed channel with a lifted thumb, real radio inputs underneath. Arrow keys move between segments. Prefer it to a row of chips when there are four or fewer, so a lone choice never wraps onto its own line. Its segments are 44 px tall on phones (a full touch target, not an overlay, which would sit over the radio) and 32 px on desktop.
- **NumberField / DurationField** — numbers with their unit inside the field (`suffix="°C"`), typed freely and kept as numbers; durations typed the way people say them ("2h 10", "2:10", "130") and shown as "2 h 10 min". TextField takes `size="sm"` for dense groups such as print settings.
- **Swatch / SwatchPicker** — a filament's color as a round chip, and a 44 px well that opens the device's color picker with common filament colors first. The color is data, so it is the one inline style allowed.
- **SpoolDisc** — a spool seen from the side, in its filament's color (data, set inline) with the faint rings of wound filament around a hub; `empty` draws a dashed ring for an empty AMS slot. Sizes `sm` (chips), `md` (rows), `lg` (AMS slots), `xl` (pantry cards), `hero` (a spool's page without a photo), and `fill`: three fifths of a square parent, which centers it, for a spool card with no photo. **A rim that always shows:** white filament on cream and black filament on a dark surface would vanish behind the usual rim (ink at 15%), so `SpoolDisc` sets `data-tone` from `colorTone(hex)` (`shared/spools.ts`: `light` from a WCAG relative luminance of 0.70, `dark` up to 0.05, otherwise `mid`) and `styles/app.css` strengthens the rim only for the pair that needs it: a `light` color in the light theme, a `dark` one in the dark theme. There the outer rim is ink at 35%, the hub rim ink at 30%, and the winding lines turn black at 12% (light) or white at 8% with the highlight at 18% (dark). Every other pair is unchanged.
- **PrintProgress** — how far a printing attempt is, from `startedAt` (the attempt's `printedAt`) and the slicer's `estimatedMinutes`. A `bar` (default; `h-1.5`, semolina fill on an `ink/8` track, never narrower than `w-1.5`) with its sentence under it, or a 20 px `ring` where a bar doesn't fit. Three states, each said in words: running ("About 45 min left" under 90 minutes, else "Done around 10:38"), due (a full, still bar and "Should be done by now" in `semolina-ink`), and unknown (no estimate: no bar and no ring, just "On the bed now"). The app never draws progress it can't know. The logic is the pure `printProgress(startedAt, estimatedMinutes, now)` in `shared/print-progress.ts` (re-exported from `components/builds/settings.ts`), which also gives the build card its meta line; the fill eases over `duration-slow` on each tick and jumps with reduced motion. It reads the clock from `useNow()` (`lib/use-now.ts`): one timer per interval for every subscriber, paused while the tab is hidden and refreshed when it returns. `OfflineNotice`'s "2 h ago" uses the same hook. It is a `progressbar` with `aria-valuetext` set to the sentence, not a live region.
- **OutcomeStrip** — a build's attempts as a row of `size-2.5` dots, oldest first, in the `outcomeDots` colors on a faint line (a printing attempt pulses). At most twelve dots; earlier attempts collapse into a "+5" count. Color never carries the meaning alone: the dots are hidden from screen readers and a visually hidden sentence says "3 attempts: spaghetti, partly, printing", and every use pairs the strip with words. With `onPick(attemptId)` each dot is a button (44 px target, focus ring, "Attempt 2: partly").
- **RemainingMeter** — roughly how much is left on a spool: three short bars (full, half, low, empty), never grams. `showLabel` adds the word beside the bars; `showLabel="lg"` shows it from the `lg` breakpoint (screen readers always hear it).
- **Caution / FromFileMark** — a gentle printer check as one semolina line with a warning icon ("The bed tops out at 120 °C."), beside the field it's about; fields take it as `caution`. Never a dialog, never blocking. `FromFileMark` is the small file glyph after a label (fields take it as `mark`) for a value that came from a slicer file and still matches it.
- **Disclosure** — optional detail behind one tap, with a one-line summary while closed (an attempt's settings).
- **ActionBar** — a screen's main action within thumb reach on phones, sitting on the tab bar ("Log attempt", "Start building"). Hidden on desktop, where the action lives in the page. Toasts move up above it while it shows.
- **ChipRow / ChipDivider / FilterGroup** — rows of filter or suggestion chips: on phones a row scrolls sideways edge to edge (with a thin divider between kinds of chips), on desktop it wraps. `FilterGroup` is one kind of filter in a desktop filter column, a caption over its chips.
- **MetaList** — a line of short pieces with a dot between them ("Black PETG · 0.20 mm · Cool Plate"): settings lines, "attempt 3 · 2 h ago", what changed. It wraps cleanly: a dot never begins or ends a line (each piece carries its dot in a gutter the row clips). Use it for every dot-separated line; `SettingsLine` is built on it.
- **Highlight** — text with the words a search matched on a semolina highlight, like a pen stroke. A tag chip that matched gets a ring instead.
- **Avatar / AvatarStack** — initials on the person's color: the first and last word's initial ("Carl Oscar" → "CO"), two letters at every size, xs included (24 px, `text-micro`). `decorative` when the person's name is already beside it (a filter chip, the account button), so screen readers don't read it twice. `via="Claude for Alex"` marks work done through an agent, and its name reads "Alex, via Claude for Alex": at xs and sm the circle keeps the owner's color and shows an agent glyph instead of the letter, at md and lg the initials stay and a badge sits outside the circle with a cutout ring; where there is room add `<ViaText>` (faint, from tablet width up). **AgentAvatar** is an agent itself on its own card: a rounded square in its owner's color with its own first letter, never a circle, so it can't pass for a person. Resolve agent names with `useVia()` (lib/agents.ts).
- **Overline** — the small uppercase caption over a group ("November so far", "Attempts 3", "Workshop"), with an optional `count`. No padding of its own: it lines up with what is under it.
- **SectionHeading** — a section's Fraunces title with an optional count ("Attempts 3", "PLA 8"); `size="title"` for quieter groups.
- **Section** — a section of a page: `<section>` named by its heading, the heading (`headline` for a page's main sections, `title` for quieter groups, `overline` for the blocks of a dense page such as Today) with its count and an optional `aside` on its baseline (a hint, a link, a small button, a figure), then what it holds, always at the same distance: `gap-4 md:gap-5` under a headline or title, `gap-3` under an overline. Sections on a page sit `gap-12 md:gap-16` apart. A `description` is a line that belongs to the heading (the outcomes so far under "Printed with it", the month's sentence on Today), 4 px under it. Build a section with it rather than a heading plus spacing classes, so screens built by different hands line up: new groups on a page (on Ideas: "Up next", "The rest", and next to them any "Started" or "Recently deleted" list) are each a `<Section id=… title=… count={n}>` around their list, `as="h3"` inside another section.
- **Skeleton / CardSkeleton / RowSkeleton** — loading states shaped like the content.
- **Kbd** — keyboard hints, hidden on phones (`always` for the shortcut list).
- **PaletteSurface / PaletteDialog** — the command palette: a search box over grouped rows (photo or icon, name, a line of meta, an outcome chip or the row's shortcut), the picked row on a quiet fill, key hints along the bottom. See Keyboard and the command palette.
- **ShortcutList** — every shortcut from the registry, grouped by screen.
- **Toggle** — an on/off setting that takes effect at once, no save button: the whole row (label, an optional quiet hint, the switch) is one `role="switch"` target of at least 48 px. The hint is where a reason goes when it can't be turned on (blocked in the browser, iPhone not installed).
- **NotificationPreview** — a picture of a "how did it go?" notification (the app mark, title, body and, where the platform has them, Worked / Partly / Spaghetti buttons). Only a picture, in settings and the styleguide; the system draws the real one.
- **Notifications** is a Sheet from the account menu: "Notify this device" (permission is asked for only when it is turned on), "Also tell me about {name}'s prints", a test notification, and the preview. Quiet hours (22:00 to 07:00 in the device's time zone) are said in the hint, not configurable.
- **Change password** is a Sheet with a form, opened from the account menu (the popover on desktop, the account sheet on phones): current password, new password, one quiet "Show" toggle instead of a confirm field, a hidden username for password managers, and its submit button in the sheet footer. A wrong current password is said under its field and nothing typed is cleared.
- **MenuGroup / MenuItem** — the rows of the account sheet and the account menu: an icon, a label, and in a sheet an arrow on rows that lead to a page (a row that opens another sheet has none). A row is a link (`to`) or a button (it opens a sheet). `size="md"` (phones) puts a group's rows on one soft `bg-paper` surface with an inset hairline between them, at least 56 px tall; `size="sm"` (desktop popovers) gives compact rows like the sidebar's. Group rows by what they are for (the workshop, under its `Overline`; your settings and the styleguide), `mt-6` apart, rather than giving each its own tile, and let the label speak without a hint after it.
- **Popover** — a small floating panel for desktop menus, such as the sidebar's account menu. Tasks use Sheet.
- **OfflineNotice** (shell) — a quiet strip at the top of the page while the server can't be reached, with how many captures are waiting and, over data kept from earlier, when it was last fetched. The only place the app complains about the connection.
- **Illustrations** (`components/illustrations`) — 160×120 spot illustrations: ink outlines at 2.5 px, round caps, one tinted circle behind, one or two accent fills. The `Mark` is the app icon: a twirl of spaghetti on a tomato tile.

## App shell

- **Phone (< 768 px):** a page header with a large title, a search button and the account avatar; a bottom tab bar (Today, Ideas, capture, Builds, Journal) with the capture button in the middle. Tabs are places and search is a tool, so search lives in every top-level page header (not on Search itself) and opens the box with the keyboard up.
- **Desktop:** a fixed left sidebar on `paper-deep` with the mark (which leads to Today), a "New idea" button, the sections (Today first) with keyboard hints, the workshop, and the signed-in person. When a print is on the bed a small card above the account button shows it (thumbnail, name, a ring and "45 min left"; "and 1 more" when there are several), hidden on Today, which shows every print in full. The styleguide is in the account menu and the command palette, not the sidebar.
- **Workshop:** the Pantry and the Printer sit under a quiet "Workshop" caption in the sidebar (`G P`, `G R`); on phones they are the first rows of the account sheet, so the tab bar keeps its four sections.
- **Keyboard (desktop):** `⌘K` (Ctrl+K elsewhere) the command palette, `?` the list of shortcuts, `C` capture, `G T` Today, `G I` Ideas, `G B` Builds, `G J` Journal, `/` Search, `G P` Pantry, `G R` Printer. Shortcuts are ignored while typing or while a sheet is open; only `⌘K` also works inside a field. Every shortcut is defined once in `src/shared/shortcuts.ts` (see Keyboard and the command palette below).
- **Capture from anywhere (desktop):** paste an image (or a link) when not typing, or drop photos anywhere on the window (a "Drop to capture" overlay shows while dragging). In the capture note, `Enter` saves and `Shift+Enter` is a new line; `Escape` closes and keeps the draft.
- **Detail screens:** phones get a full page with a sticky back bar; desktop puts the photos beside the text. `Escape` goes back, arrow keys move between photos, `Backspace`/`Delete` deletes with undo.

## Keyboard and the command palette

Desktop only. Phones have no palette and no shortcut list; their layouts are untouched.

- **One registry.** `src/shared/shortcuts.ts` lists every shortcut: id, where it works (anywhere, an idea, a build, the journal, search, the palette), what it does and its keys (`"c"`, `"g i"`, `"mod+k"`, `"arrowdown"`). Screens bind handlers to ids (`useHotkeys({ buildLog: primary })`), the listener reads the keys from the registry, button hints come from `shortcutCaps(id)`, and the `?` overlay is generated from the same list. A new shortcut is one entry there plus a handler; a unit test fails if two shortcuts share a key on the same screen.
- **Typing is safe.** Nothing fires while the focus is in a field (input, textarea, select, contenteditable) or a dialog is open. The exception is `⌘K`, which opens the palette from inside a note you are writing.
- **The palette** (`⌘K`, or "Jump to…" at the top of the sidebar) opens at once, high on the screen, and never shows a spinner page. Before typing: what fits the screen first ("This build": log or finish an attempt, finish or shelve the build; "This idea": start building), then recent ideas and builds, then actions (new idea, switch theme, shortcuts, sign out) and "Go to" the sections. Typing narrows actions as you type and searches ideas, builds and attempts through the search API a beat later: builds, ideas and attempts with their photo thumbnails and outcome, the previous results dimmed until the new ones arrive. Arrow keys move, `Enter` opens or runs, `Esc` or `⌘K` closes. A row that starts a sheet runs after the palette has closed, so focus lands in the sheet.
- **A screen offers actions** with `useScreenActions("This build", [...])` while it is shown; the palette reads them when it opens.
- **`?`** opens a calm overlay with every shortcut in columns, grouped by screen, with alternatives side by side ("J or ↓").
- Components: `PaletteSurface` and `PaletteDialog` (ui/Palette.tsx), `ShortcutList` (ui/ShortcutList.tsx); both are in the styleguide.

## Today

The front door (`/today`, where signing in and `/` lead): a calm answer to "what now". It holds five blocks in this order on a phone and in two columns from `lg` (the main column on the left, a sticky column with the printer and the month on the right), `gap-10` apart, each under an `Overline`. **A block with nothing to say is not drawn**, so a quiet day is a quiet page; the blocks resolve as their own queries do, and everything opens offline from the saved copy.

- **On the bed:** a `PrintingCard` for every attempt still printing, the one that should be done by now first. The build's picture (its hero photo, else the slicer's plate picture, else its name on a `NoteFace`), the name in Fraunces (the one card title set that way: this is the focal point of the screen), "attempt 3" and the filaments, `PrintProgress`, and a quiet **Finish** button that opens the build with that attempt's sheet. When the print should be done, the button gives way to "How did it go?" and the outcome picker; picking one opens the sheet with that outcome already chosen (`/builds/$id?attempt=…&finish=1|success|partial|failed`, the parameter is spent once the sheet is open). There is no tomato button on Today: capture stays the one primary action. On phones only the first print gets the big card; the ones after it are `compact` (a small square picture beside the name, the progress and answers full width under it), so three prints don't push the rest of Today two screens down. Desktop shows every print as the same row.
- **Pick up again:** builds in progress with nothing printing, most recently touched first, four at most ("All builds" after them): a thumbnail, the name, the last outcome as a word in its ink, its first failure tag and when, and an `OutcomeStrip`.
- **In the printer:** a read-only strip of what is loaded (a `SpoolDisc` per slot with its slot under it, the AMS units and the external spool divided by a hairline) leading to the Pantry, and up to two sentences about spools that are low or empty. Not drawn when nothing is loaded.
- **The month so far:** the sentence the journal writes under the same heading, and the three newest entries as `compact` journal rows (without the print already on the bed), then "See the whole journal".
- **On the back burner:** one idea older than two weeks, chosen by a hash of the local date so both people see the same one all day, with a "Start building" button (disabled offline, like every change to saved data).
- **States:** skeletons while loading, "Nothing on the stove yet" for a brand-new notebook, "All quiet in the kitchen" when nothing is printing and nothing is waiting. The command palette offers "Finish attempt 3 of …" for each print on the bed.

## Ideas

- **Capture** saves at once: the sheet closes, the idea lands at the top of the inbox (with a small spring) and its photos upload in the background with progress on the card. Nothing waits on the network.
- **The inbox** is a grid of 4:5 cards, newest first: two columns on phones, three, then four on desktop. Text-only ideas are note cards in the same grid, the note set large in Fraunces when it is short and smaller as it grows, so every card looks filled on purpose. The author is a small avatar, the time is relative ("2 h ago").
- **An idea's page** has the build page's proportions: on desktop the photos take two parts and the text three (gaps `md:gap-10 lg:gap-14`), the text at a readable measure (`max-w-content`). An idea that grows into a build keeps its photo in the same place at the same size, and the attempts take the side the text had, so "Start building" reads as the page growing, not changing. Without photos, and on phones, nothing changes.
- **Link cards** (`LinkCard`, `NoteLinks`): under the note on the idea and build pages, one card per distinct link in it, in order, three at most; the links in the note stay as they are. A card is a `bg-cream` link that opens in a new tab: the site's first letter on a tile, the page's title (two lines) and its site name, a small arrow top right. It shows at once with the short address, and the title fades in over `duration-fast` when it arrives; its height is fixed, so nothing jumps and there is no skeleton. No remote pictures in this version: they break offline, tell the other site about the visit and shift the layout. The title comes from `GET /api/links/preview` (`linkPreviewQuery`, a day fresh, kept for offline), which is people-only and strict about what it fetches (see docs/api.md).
- **Started ideas stay.** "Start building" doesn't take an idea out of Ideas: a build that began as an idea (captured, then started) sits in a quiet "Started" section after the unstarted ideas and "The rest" (rows with a small photo, the stage in words, newest start first, six at most then "See all in Builds"); a tap opens the build. Unstarted ideas always come first. The toast after Start building says so.
- **Recently deleted** (`/deleted`): ideas, builds and attempts deleted in the last 30 days, each row with a Restore button and the days left ("goes for good in 12 days"). Reached from the account menu and a quiet link at the foot of Ideas and Builds. Calm and plain, no empty-state fuss; an empty idea or build deleted untouched isn't listed.
- **Delight**, in small doses: the first idea ever gets a "First one in the pot" toast, once per device; new cards land with a quick spring.

## Talking it over (comments)

A short thread at the foot of every idea and build ("Talk it over", `components/comments/`, lazy-loaded; decision [0024](decisions/0024-comments-read-state-and-push-batching.md)). It is a small conversation in a kitchen notebook, not a comment widget: no borders, no table, no empty box.

- **Messages** (`MessageGroup`, `Bubble`, `NewDivider` in `ui/Message.tsx`): one person's consecutive messages (within five minutes, `groupThread` in `shared/comments.ts`) sit together under one avatar, name and relative time; the other person's at the start on `cream`, yours at the end on `tomato-soft`, so who spoke reads before any name does. An edit shows a quiet "(edited)"; an agent's comment adds "via Claude for Alex" and the agent mark on the avatar. Links in the text are links, and the first few get the usual link cards underneath.
- **Empty is one line.** With nothing written the section is a single quiet field ("Say something to Marie", the other person's name) and an invisible heading: it takes almost no room. Once there are messages the heading and the conversation appear above the same field.
- **Writing** (`Composer` in `ui/Composer.tsx`): on a keyboard the field is inline under the messages, `M` focuses it (`ideaComment` / `buildComment`, and the palette's "Say something about this …"), Enter sends, Shift+Enter breaks the line, Esc leaves, with the three hints under it while it has focus. On a phone the field is a field-shaped button that opens a sheet (which rides the keyboard, `--sg-keyboard-inset`) with the same composer; Enter is a line break there and the round tomato send button sends. Sending is optimistic and closes the sheet; the draft is kept per thread on the device (`localStorage`) and shows as "Draft: …" on the phone's button. A message that can't be sent goes back into the draft with a toast, so nothing typed is lost.
- **Your own messages** have a quiet "…" (hover or focus on desktop, always on phones, 44 px target): a popover on desktop, a sheet on phones, with Edit (the bubble becomes a field in place; Enter or leaving saves, Esc leaves it as it was) and Delete (Undo toast, no dialog).
- **New:** the other person's comments you haven't read show a "New" line (tomato caps between hairlines) before the first of them, kept in place while you read, and a tomato "1 new comment" badge (`UnreadBadge` on `Card`'s `unread`) over the card's photo on Ideas and Builds, until you open the thread. The palette lists threads with new comments first.
- Offline the thread is readable if the idea was cached; writing is read-only like every saved thing, and the draft stays.

## Builds and attempts

- **One record, many stages.** An idea becomes a build in one tap ("Start building", `B` on desktop) and keeps its photos and notes; it lives under Builds from then on. A build can also start from scratch. Deleting a build that began as an idea scraps it: it goes back to Ideas as an idea (its attempts are deleted with it) with an undo toast ("Build scrapped · Flexi Mini is back in Ideas"); a build that never was an idea is deleted as before. A new build left empty (no title, note, photo or attempt) removes itself when you leave it, without a toast.
- **The builds list** puts what's on the bed first, printing before the rest, each card with its newest photo and how the last attempt went (an outcome chip over the photo). Done and shelved builds sit below as quieter rows.
- **A build** leads with its best photo (the final print once done), then its story: attempts newest first, each on a thread whose dot is the outcome's color. Each attempt says what changed since the one before ("bed 55 → 60 °C", "added a brim") on a semolina highlight: this is how the app answers "what worked". A "What worked" card repeats the latest attempt that came out right. Desktop puts the build and the story side by side; `A` logs an attempt (or finishes the one printing), arrow keys or `J`/`K` move through attempts, `Enter` opens one.
- **The build summary** (`BuildSummary`) sits under the notes from the second attempt on, on phones and desktop alike, so the left column has something to say while the story scrolls. It is reference text on paper, no surface: an overline ("So far" while the build is open, "In all" once it is done or shelved), the `OutcomeStrip` with its words ("1 spaghetti, 1 partly, printing now"; tapping a dot selects that attempt and scrolls to it, as `J`/`K` do), a `MetaList` of the time and filament spent, and the filaments used (a `Swatch` and a name each, four at most then "+2 more", linking to the spool when it came from the pantry). The sums come from `summarizeBuild` (`shared/attempts.ts`) and never claim more than they know: time adds each finished attempt's own time, else its estimate, and then reads "about 6 h 22 min"; weight reads "at least 130 g" when some attempts have none; a figure nobody has is left out; a print still on the bed counts for the words but has spent nothing yet.
- **Attempt photos line up.** On desktop an entry's lead photo is always 4:3 at most `max-w-md`; more photos are a `w-32` column beside it, as tall as the lead, two tiles at most with a "+N" veil on the second. When any attempt of the build has more than one photo, every entry keeps that column's room free, so the leads are the same size all the way down. Phones are unchanged.
- **Comparing two attempts** answers the question the app exists for: did it help? An entry's changes line is a button (the same semolina chips, then a quiet "Compare" with `CompareIcon`), or a quiet "Compare with attempt 2" when nothing changed; `V` on desktop and "Compare attempt 3 with attempt 2" in the palette do the same for the picked attempt (else the newest). The `CompareSheet` is a wide dialog on desktop: a column per attempt, older on the left, each header an outcome chip, the attempt's name as a `Popover` that lists every attempt (picking one swaps that column) and its date; the photo uncropped (`fit="contain"` on `paper-deep`; a row of `PhotoThumb`s picks among several; "No photo" in a `well` tile when there are none), the note and tags; then **What changed** (label, before, and the after cell on the same semolina highlight as the chips), **Same in both (7)** behind a `Disclosure`, and **How it went** (time, filament, where it failed, side by side with no highlight: results, not choices). On phones it is a full-height sheet that compares the attempt with the one before it: a `SegmentedControl` ("Attempt 2" / "Attempt 3") over one photo that crossfades in place over `duration-fast` (swapping at once with reduced motion), a sideways swipe on the photo switches too, then the chosen attempt's chip, note and tags and the same table. A print still on the bed can be compared: it shows its Printing chip and no results. `diffSettings(before, after)` gives every known setting as `{ key, label, before, after, changed }`, and `describeChanges` is made from it, so the chips on an entry and this table can never disagree.
- **Plates** are named the way people say them: "Textured PEI" and "Smooth PEI", but "Cool Plate", "Engineering Plate", "High Temp Plate" in full (a bare "Cool" reads as a temperature). `plateName` in `shared/attempts.ts`.
- **Outcomes** are Worked (basil), Partly (semolina) and Spaghetti (tomato, soft): a failure is not an error. Printing is semolina with a gentle pulse, and a print on the bed shows `PrintProgress` (a bar and how long is left) beside its Finish button; the build card says "Attempt 3 · about 45 min left" instead of when it started.
- **Off the bed** — a print the printer bridge saw stop (`attempt.endedAt`) that nobody has judged yet (`isOffTheBed` in `shared/print-progress.ts`). It is not "printing" and not an alarm: a neutral "Off the bed" chip (flag icon) instead of the pulsing "Printing", no "should be done by now", and a calm line, "Off the bed at 10:42 · how did it go?" (`OffTheBed`, `components/builds/OffTheBed.tsx`). On the build page it has the three outcome buttons right there (the medium `OutcomePicker`); tapping one opens the attempt sheet with that outcome chosen. On the build card and in the journal (cards that are links) it is the chip and the sentence. The printer's **suggested failure tag** is pre-selected in the sheet when the outcome is Partly or Spaghetti, marked "· suggested" with a line saying the printer suggested it, and is the person's to take off (`TagPicker`'s `suggested`); Worked takes none. The printer can't know whether a print worked, so the app never fills the outcome itself.
- **Live progress** — while the bridge's last report is under three minutes old, `PrintProgress` (via `usePrintProgress`, `lib/print-progress.ts`) shows the printer's own progress: the bar at its percent and "Layer 112 of 240 · about 38 min left" (`livePrintProgress`), and falls back to the slicer's estimate by itself when the bridge goes silent. `PrintProgressView` is the same bar or ring for a result worked out elsewhere (the styleguide).
- **Printer bridge line** — `BridgeLine` (`components/pantry/BridgeLine.tsx`), one quiet `text-small ink-faint` line on the Printer page with a dot (basil when connected, otherwise a faint one): "Printer bridge connected.", "… can't reach the printer.", "… last heard 3 h ago." or "No printer bridge set up. How to set one up" (a link to `docs/bridge.md`). Not setting it up is information, never a warning. A tray the bridge can't match to a spool shows on its AMS slot as "Which spool?" with "Printer sees PETG" in `semolina-ink`; tapping it is the ordinary spool picker.
- **Parts** are optional. A build without them looks as it always did, with at most a quiet "Add parts" under the summary (and "Parts from the file: Hull half ×2, Deck" when its slicer file names objects). With parts, `PartsSection` is reference text on paper where the summary is: each part's name, a pip per piece needed (basil once made) and "1 of 2" or "done"; never a table. Editing is inline and autosaves (`PartsEditor`, loaded only when editing starts); removing offers Undo. When every part is printed a soft basil line offers "Finish the build"; it never finishes on its own. The attempt sheet gets a "What's on the plate" row of part chips, each with a `Stepper` for the good pieces (a spaghetti zeroes them), and a plate from a slicer file preselects its parts. Attempts name their parts ("Attempt 3 · Hull half") on the build page, in the journal, on Today's printing card and in search.
- **The attempt sheet** (bottom sheet on phones, right panel on desktop) asks only for the outcome, in three big buttons; the time is now. Photos, a one-line note, failure tags (when it didn't work), success notes (when it did) and settings are one tap away. A new attempt starts from the attempt before's settings, so people change only what they try differently. "Still printing" saves it now to finish later.
- **Finishing** a build is one action, with undo; it picks the final photo (the newest photo of the last attempt that worked). A build that had spaghetti gets the one delight toast, "Al dente", with a sparkle on the Done chip.
- **Capture always opens on "New idea"** (sidebar button, `C`, the + button, a dropped or pasted photo), on every screen: someone standing at the page of one idea usually has a new one, and adding to the wrong thing quietly is worse than one extra tap. On an idea's or a build's page, or while something prints, the segmented control's second segment offers "This idea", "This build" or "This print" (photos join it, the note goes into its notes; a print can be finished). Nothing guesses the target.

## Pantry and printer

- **The pantry** is the shelf of spools, named for the kitchen (and because "On the shelf" already means shelved builds). The AMS comes first, drawn as the unit itself: four bays with their spools in color, then the external spool holder as a wide row. Tap a slot to pick its spool in a sheet (the spool in it first, "Take it out" in the footer, "New spool" loads the new one straight into that slot); on desktop, drag a spool card onto a slot, or one slot onto another to swap. Below, spools are grouped by material in a grid of cards: the label photo when there is one, else the spool filling three fifths of a square well (`SpoolDisc size="fill"`, which turns a little on hover), with what's left and where it's loaded.
- **AMS bays say what is left.** Below `lg` a bay is a column: the disc, the slot, the name, the material, and a centered `RemainingMeter` (bars only). From `lg` it is a row like the external holder, filling its tile edge to edge: the disc on the left, then the slot, the name, a material line and the meter with its word. When the spool has been dried, the material line is a `MetaList` ("PETG · drop 12 d ago"): a fact, not a warning, and absent for a spool never dried. A spool that is empty but still loaded says "Empty" in words at every width.
- **Cards or list, on desktop.** A heading row, "All spools" with the count, carries a Cards / List `SegmentedControl`; the choice is remembered per device (`localStorage`, `sg-pantry-view`, `lib/pantry-view.ts`) and phones always show cards. The list is the same material groups (an `Overline` with its count) over one `bg-cream` surface; each `SpoolRow` is a link with the disc, the name and detail, the meter with its word, the slot chip and when it was dried, with no header row (each column says what it is with a word or an icon) and a `bg-hairline` line between rows, the one place the design language draws a line. Within a group it reads low, half, full, then empty. An empty spool's disc dims; its text stays at full contrast, because dimming text drops it below AA.
- **Adding a spool** takes seconds: snap the label (or not), a material chip, a color swatch (the color name fills itself in until you type one), done. Brand and finish are a tap more. `N` on desktop.
- **A spool's page** edits it in place (autosave): what's left, loaded where, dried when ("Dried it today" is one tap), material, color, brand, finish, notes. Below, every attempt printed with it and how they went: "how does this silk PLA behave" is one tap.
- **The printer page** is quiet: the X2D's facts (build volume, limits) and what people change: the nozzles fitted (size, hardened), the plates they own, the AMS units. Spaghetti never talks to the printer, and says so.
- **Gentle checks** while logging an attempt (`printerHints` in `shared/spools.ts`, from docs/printer.md): a nozzle over 300 °C or a bed over 120 °C, TPU on the auxiliary nozzle or through the AMS, PVA through the AMS, PPS at all, abrasive filament on a nozzle that isn't hardened, a nozzle size that isn't the one fitted. Each is a Caution beside its field; with the settings closed, the first one shows under them.

## Slicer files

- **Drop a .3mf** (Bambu Studio or Orca, project or sliced) on a build (a new attempt), on an attempt in its story (that attempt), or on the open attempt sheet; phones pick one from the sheet's "Add the slicer file" well. The drop overlay says so while dragging over a build.
- **One tap for the plate** of a multi-plate file: the plates' pictures as buttons. Then the file fills in the attempt: filaments (matched to pantry spools by material and a color people would call the same; unknown ones are one tap to add), plate, nozzle, layer height, infill, walls, supports, temperatures, the process preset, and the slicer's time and weight. The settings open to show it; each value from the file carries the file mark until changed. "What worked last time" steps aside: the file says what this attempt is.
- **The file stays with the attempt** as a card: the plate's picture (what was meant to print), the name, plate and estimate, and a download button. Files over 25 MB keep only what they said, and the card says so. Parsing is all in the browser; the Worker only stores the bytes.
- **Estimated vs actual:** finishing an attempt that was started as "still printing" fills in how long it took (when that's believable next to the estimate), and the attempt then says "Took 1 h 18 min, 6 min longer than the slicer's 1 h 12 min".

## Journal

- **Everything that happened, newest first:** print attempts as photo-led cards, and quieter rows for ideas captured and builds started, finished (a bigger photo, in basil) or shelved. A spaghetti attempt is the same card as a success: its outcome chip over the photo and its failure tags in plain view.
- **One icon per row:** an event row without a photo shows its icon once, in the tile (the finished row keeps its basil tile); the label beside it carries no icon. When a photo fills the tile, the icon stays beside the label, because it is then the only mark of what kind of event this is.
- **An attempt without a photo** shows the slicer's picture of its plate in the photo's place, contained on a well in a shorter 16:9 frame on phones (a render isn't a photo; photo cards keep 4:3) and labeled "Slicer preview" (a render must never pass for a photo of the result), with the outcome chip bottom left. A print in progress also shows `PrintProgress` between the title and the settings. With neither a photo nor a file the card is text only, led by its outcome.
- **`compact`:** every entry as a row (a 48 px thumbnail, the outcome's icon and word in its ink, the time, then the build's name and "attempt 2"; a ring for a print in progress). It lives in `JournalEntry` so Today's "Lately" and the journal can't drift apart. The styleguide's "Journal entries" shows cards, rows and the compact variant.
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

## Recipes

A recipe is "this is how we print silk PLA now": the settings of an attempt that worked, named, kept to start the next one from ([0017](decisions/0017-recipes-are-frozen-attempts.md)). It is a notebook card (`RecipeCard`): the picture of the print it came from first, the name, what it is for ("Silk PLA", uppercase caption), the settings in one quiet line, the note. Its name and note are the only editable things (autosaved in `RecipeSheet`, which also has Delete with an undo toast); the settings are the attempt's and the sheet says so.

- **Saving:** "Save as recipe" on a print that worked: in the attempt sheet (the name field opens in place, not a sheet in a sheet), on an attempt in the build's story, and on the What worked card. The name is already filled in from the spool's finish and the material and selected, so one tap saves.
- **Where they show:** under the spool ("Recipes for silk PLA", matched by material and finish), under each Pantry material group ("Recipes for PLA"), in search as their own group (the card shows a *Recipe* chip), and on the What worked card when its material has one. A shelf with no recipes draws nothing.
- **Starting from one:** "Start from a recipe" in a new attempt's sheet, beside What worked last time, opens compact cards; picking one fills in the settings (the spool already chosen stays) and the settings line then says "Same as recipe …" or "Changed from recipe …: bed 70 °C", the way it does against the previous attempt. Undo puts the settings back. Nothing is asked afterwards.

## Year so far

One screen (`/year`, linked quietly from the journal's first month line, "See the year") that says what a year adds up to in a few large figures and sentences, never a dashboard. The figures use `text-figure` (display face): prints, and the share that worked in basil. Right after them on phones (beside the rates on the desk) comes **What got made**: a mosaic (`Mosaic`) of the final photo of each build that worked this year, newest first, square thumbnails that open their build (four across on phones, three in a wider column on desktop, a dozen shown and the rest counted: "and 8 more"). The outcome colors are explained where they appear, with small dots in the sentence under the figures ("8 came out partly, and 7 turned to spaghetti"), so there is no legend. Then two quiet components built on the outcome colors in `tokens.css` and labelled in words for screen readers, with direct labels instead of a legend:

- `MonthBars`: prints by month as stacked bars (worked at the bottom, spaghetti on top), the busiest month naming its count, empty months a faint tick, months still to come dimmed. No axis.
- `RateRows`: success rate per group (material, plate) as a name, a basil bar and "83% worked · 12 prints".

"What went wrong, and what helped" is sentences: each failure tag in the display face with its count and "Fixed twice by a brim and once by a warmer bed." (`fixSentence`; the changes come from `diffSettings` between a failed attempt and the next one that worked, `src/shared/insights.ts`). Nothing is interactive beyond links into the journal or search filtered to that slice. "Took the most tries" are photo rows: thumbnail, name, `OutcomeStrip` and the attempt count. Phones stack the sections in one column with the two figures side by side. Desktop (from 1024 px) gives the figures and the month bars the full width, then two columns: material, plate and what helped on the left, the mosaic and the photo rows on the right. The styleguide's "Year so far" shows both components.

## Accessibility

- `e2e/accessibility.spec.ts` runs axe (WCAG 2.1 A and AA, best practices) on the main screens, the sheets, the palette and the empty states, at both widths and in both themes. A new screen gets a line there.
- Links and buttons are named by what they show. Don't put an `aria-label` on a card or row that has visible text: it hides the rest from screen readers, and voice control can't find it by what people see. Decorative pictures inside a named link get `alt=""`.
- Outcomes never rely on color alone: each has its icon and word (`OutcomeChip`), and the attempt thread's colored dot sits beside that chip.
- The toasts (sonner) and the `OfflineNotice` are live regions; reduced motion is respected in CSS, `MotionConfig` and JS scrolling.

## Performance

`e2e/performance.spec.ts` (Playwright project `performance`, on the production build) measures each screen's first-load JavaScript against a budget and scrolls an inbox of 100 photo ideas at 4× CPU throttling. What's rarely used loads on demand: the styleguide (its own route), the `.3mf` reader (imported when a file is dropped), the command palette and shortcut list (fetched once the app is idle, on desktop only), the desktop account menu (fetched once the app is idle, or on the first press, with `useWhenIdle` from `lib/when-idle.ts`), and the change-password sheet (fetched when asked for). Sheets that a menu opens mount only once asked for: in the production build, a closed sheet that mounted while another sheet was open looped (React error 185). Route search params are checked by hand, never with zod: a route's `validateSearch` loads with the app, and zod alone is 22 kB gzip (the performance test fails if a screen loads it). Photos in lists are lazy thumbnails (600 px), and warming photos for offline waits until the screen's own have had a head start. Tab bar and sidebar links preload their section's code once visible, and the idea and build pages once the app is idle, so the first tap doesn't wait for it. A `lazy()` component always sits in its own `<Suspense>`. The shell opens from the remembered session (checked in the background), and Latin Figtree and Fraunces are preloaded in `index.html`, so a launch doesn't flash a fallback font. How to measure: AGENTS.md, "Measuring speed".

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
- **`/api` is never cached by the service worker**, except photos (`/api/photos/:id/thumb|large`, which never change once saved): photos already seen show offline. Everything else goes to the network every time, so nobody sees another person's stale edits as current. Signing out clears the photo cache.
- **What was last seen is kept on the device, read-only.** The client persists its TanStack Query cache to IndexedDB (`lib/persist.ts`, database `spaghetti-cache`): the ideas and builds lists, every item page opened (with its attempts, so "what worked" is there), tags and people, and the last results of the journal, search, its filter facets and "what worked" suggestions (the most recent 12 journal lists, 48 month summaries, 10 searches and 20 suggestions). Only the roots in `PERSISTED_ROOTS` are saved: a new screen that should open offline adds its query's first key there. The copy is capped (40 item pages and the per-group limits above, about 3 MB, 7 days) and dropped on sign-out, like the photo cache, and when someone else signs in. With nothing kept (a first visit offline), the inbox still says the pot is out of reach.
  - Online nothing changes: restored data only fills the screen until the network answers (every restored query is refetched at once, and an item page opened from a restored list counts as exactly as old as the list). Offline, or when a request fails, it stays.
  - Never current: the `OfflineNotice` says "Showing what you saw 2 h ago" over it. The time is when the server last answered that query (`recordFetch` on a successful fetch, saved with the copy), not when it was last edited here, and it only moves when a fresh fetch replaces the data.
  - Read-only: a field or action that changes something saved on the server (title and note, stage changes, deleting, removing or reordering photos, editing a saved attempt) is disabled or read-only offline (`useReadOnly`, `canEdit` in `lib/read-only.ts`), with the notice as the one place that says why. Things still waiting in the outbox stay editable, and captures, logging attempts and adding photos keep working through the outbox. Queuing edits of saved fields was left out on purpose: another person may have changed the same field, and a late write would silently overwrite theirs.
  - **Finishing a print still works offline**, because it only fills what was empty. On a print that is still printing, "Finish attempt N" (or the capture sheet's "Add to the print" with an outcome) queues a finish in the outbox: outcome, when it came off the bed, note and tags, with the photos behind it. It shows as finished at once, the strip counts it ("1 finished print is waiting"), and `POST /api/attempts/:id/finish` applies it when the connection is back: still printing, it is finished; someone else already finished it, their outcome stands, the photos are still added, the note is appended, and a quiet toast says so once ("Sam had already finished attempt 3"). It is safe to repeat. Settings and the print time stay read-only in that sheet.
  - **Photos are kept for offline too.** Besides every photo the service worker has served, `lib/warm-photos.ts` quietly fetches (low priority) the card thumbnails of every item in a list that arrives, and for an item page opened online its thumbnails plus the large hero and each attempt's lead photo. It skips Save-Data connections and fetches at most 240 pictures per visit.
  - A screen with several autosaved fields (a spool, the printer's setup) uses `useLiveFields` (`lib/use-autosave.ts`): each field follows the server's copy unless it was typed in, and a save sends only the fields changed here. `PUT /api/printer` therefore takes any part of the setup and keeps the rest.
  - Autosaved fields follow the server (`useFollowServer`) when a fresh answer differs from what was kept, unless the person has typed since.
- **Captures** keep working: the app opens as the person last signed in (remembered locally; the server checks again as soon as it can, and a 401 signs out), a capture goes into the IndexedDB outbox, and it is sent when the connection is back. The `OfflineNotice` is the one place that says so; `lib/connection.ts` decides (the browser's `online` flag, failed requests, and a quiet `/api/health` probe).
- **Updates** install in the background. A quiet "A new version is ready" toast offers Refresh; otherwise the new version takes over after every tab has been closed. Nothing captured is lost either way.
- **Install:** `manifest.webmanifest` (`id`, standalone, any and maskable icons) and `manifest-dark.webmanifest`, which the page swaps in when dark so a dark install gets a dark splash.
