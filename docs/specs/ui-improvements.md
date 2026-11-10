# Spaghetti UI improvements: implementation spec

Nov 10, 2026 · @Carl Oscar Aaro

## How to use this spec

These are UI changes to Spaghetti, written so an agent can implement each section as one pull request. They come from running the app on its seed data and reviewing every main screen at 390 px and 1440 px, light and dark.

Read `AGENTS.md` and `docs/design.md` first, and open `/styleguide` in the running app. Where this spec adds to the design language, update `docs/design.md` in the same pull request so it stays the rulebook.

Rules that apply to every section:

- **Tokens and shared components only.** No hex colors, arbitrary sizes or one-off shadows; `pnpm lint` fails on them. A new visual need becomes a token (light and dark) or a component in `src/client/components/ui`.
- **Two layouts, two themes.** Every change is designed and checked at 390 px and 1440 px, in light and dark.
- **One tomato action per screen.** Everything else is `secondary` or `quiet`.
- **Skeletons, autosave, undo.** No spinners, save buttons or confirm dialogs.
- **Meaning never rests on color or motion alone.** Each state has an icon or a word. With reduced motion, show the end state at once.
- **Voice.** Short, warm, plain. Sentence case, no exclamation marks, at most one pasta joke per screen.
- **Offline.** A new screen that should open offline adds its query root to `PERSISTED_ROOTS` in `lib/persist.ts`. Anything that edits saved data respects `useReadOnly`.

Each section states its size and whether it needs server work. Suggested order: 1, 5, 6, 9, 3, then 2 together with 7, then 4 and 8. Copy in quotation marks is final wording, not a placeholder.

Out of scope: features with no screen today (push notifications, a printer bridge, filament grams, parts). They need their own specs.

## 1. Shared building blocks

Three small pieces are used by several sections below, so build them first. Each gets a styleguide entry and a paragraph in `docs/design.md`. Size: small. Server work: none.

### PrintProgress

A new `src/client/components/ui/PrintProgress.tsx` shows how far a printing attempt is, from its start time and the slicer's estimate. The app shows only a pulsing chip and a sentence today.

| Prop | Type | Notes |
| --- | --- | --- |
| `startedAt` | epoch ms | The attempt's `printedAt` |
| `estimatedMinutes` | number, optional | `settings.estimatedMinutes` |
| `variant` | `"bar"` or `"ring"` | Bar by default; ring where there is no room for a bar |
| `showLabel` | boolean | Bar only, on by default |

| State | When | What is drawn | Label |
| --- | --- | --- | --- |
| Running | Estimate known, time left | Fill `bg-semolina` on a `bg-ink/8` track, width = elapsed / estimate | "About 45 min left" under 90 minutes, else "Done around 10:38" |
| Due | Elapsed is at or past the estimate | Full bar, still | "Should be done by now" in `text-semolina-ink font-semibold` |
| Unknown | No estimate | No bar and no ring | "On the bed now" |

Never draw progress the app can't know: without an estimate there is no bar.

- **Bar:** `h-1.5`, `rounded-pill`, as wide as its container. The fill is never narrower than `w-1.5`, so a print that just started still shows.
- **Label:** `text-small text-ink-soft tabular`, `mt-1.5` under the bar, left aligned.
- **Ring:** move `ProgressRing` out of `UploadBadge.tsx` into `ui/ProgressRing.tsx` and reuse it at 20 px.
- **Time:** add `useNow(intervalMs = 30_000)` in `lib/use-now.ts`. One shared timer serves every subscriber, pauses while `document.hidden`, and refreshes on `visibilitychange`. `OfflineNotice` has its own 30-second interval today; switch it to this hook.
- **Logic:** move `doneBy` from `AttemptEntry.tsx` into `components/builds/settings.ts`, beside a pure `printProgress(startedAt, estimatedMinutes, now)` that returns `{ fraction, state, label }`. Unit-test it in `test/unit`.
- **Motion:** the fill's width eases with `duration-slow ease-out` on each tick. With reduced motion it jumps.
- **Accessibility:** `role="progressbar"`, `aria-valuemin="0"`, `aria-valuemax="100"`, `aria-valuenow`, and `aria-valuetext` set to the label. It is not a live region.
- **First use:** in `AttemptEntry`, replace the "Should be done…" sentence with the bar and label. The "Finish" button stays on the right.

### SpoolDisc: a rim that always shows

White filament on cream and black filament on dark surfaces nearly vanish, because the rim is a fixed `ring-ink/15`. The fix strengthens the rim only when the filament color is close to the surface in the current theme.

- Add `colorTone(hex)` to `src/shared/spools.ts`, returning `"light"`, `"mid"` or `"dark"` from WCAG relative luminance: 0.70 and above is light, 0.05 and below is dark. Unit-test with the seed colors: `#f4f1ea` is light, `#1d1d1f` is dark, `#00ae42` is mid.
- `SpoolDisc` sets `data-tone` from it. Styles live beside `.spool-wound` in `styles/app.css`.

| Theme | `data-tone` | Outer rim | Hub rim | Winding lines |
| --- | --- | --- | --- | --- |
| Light | light | `ink` at 35% | `ink` at 30% | black at 12% (from 7%) |
| Dark | dark | `ink` at 35% | `ink` at 30% | white at 8%, and the top-left highlight at 18% |
| Any other pair |  | Unchanged | Unchanged | Unchanged |

- Add a size `fill`: `size-3/5` of a square parent, for spool cards without a photo (section 5).
- Styleguide: show a white, a black and a green spool side by side in both themes.

### OutcomeStrip

A new `src/client/components/builds/OutcomeStrip.tsx` draws a build's attempts as a row of dots, oldest first. The build summary (section 3) and the Today rows (section 2) use it.

- **Dots:** `size-2.5`, `rounded-full`, colored with the existing `outcomeDots` map, `gap-1.5`. A `h-0.5 bg-ink/10` line runs behind their centers. A printing dot gets `animate-pulse`.
- **Long builds:** at most 12 dots. Earlier attempts collapse into a `text-caption text-ink-faint` count before the dots, such as "+5".
- **Accessible name:** the dots are `aria-hidden`; a visually hidden sentence says "3 attempts: spaghetti, partly, printing".
- **Optional `onPick(attemptId)`:** each dot becomes a button with `touch-target`, `focus-ring` and `title="Attempt 2: partly"`.
- Color never carries the meaning alone, so every use below pairs the strip with words.

## 2. Today screen

A new home screen answers "what now" in one glance: what is printing, what to pick up again, what is loaded, and what happened lately. Today `/` only redirects to Ideas. Size: large. Server work: none; it reuses queries the app already has.

### Wiring

- New route file `src/client/routes/_app/today.tsx` at `/today`. `_app/index.tsx` redirects there instead of `/ideas`.
- `components/shell/sections.ts`: add Today as the first section, with `TodayIcon` (Phosphor `CookingPot`, added to `ui/icons.tsx`) and a new shortcut `goToday` with keys `g t` in `src/shared/shortcuts.ts`.
- Data: `useBuilds()`, `useIdeas()`, `spoolsQuery`, `printerQuery`, the first page of `journalQuery` with no filters, and `summaryQuery` for the current month. All of these roots are already in `PERSISTED_ROOTS` so Today opens offline.
- The build route gains one search param, `finish`. `/builds/$buildId?attempt=<id>&finish=1` opens the attempt sheet for that attempt. `finish=success`, `partial` or `failed` opens it with that outcome already picked.

### Phone layout

```
Today                         (AR)
Tuesday, November 10

ON THE BED
+--------------------------------+
| [ picture 4:3 ]                |
| (o Printing)                   |
| Bath tugboat for Mila     (A)  |
| attempt 3 . yellow PLA, white  |
| =========-------------         |
| About 45 min left     [Finish] |
+--------------------------------+

PICK UP AGAIN
[#] Cable chain             o
    Spaghetti . Warping . 3 d ago
[#] Hook for the desiccant  o o
    Worked . 2 days ago

IN THE PRINTER             Pantry
(O) (O) (O) (O)  |  (O)
 A1  A2  A3  A4     Ext
||. Sunflower yellow in A2 is low

NOVEMBER SO FAR
10 prints, 3 spaghetti, headphone
stand and lithophane lamp finished
[#] Finished after 3 attempts
    Headphone stand
[#] Captured an idea . 7:55 AM
    Found this on the bed...
See the whole journal

ON THE BACK BURNER
[note ] Replacement knob for
[card ] the oven
        Alex . 5 weeks ago
        [Start building]
```

Sections sit `gap-10` apart. Each starts with an `Overline`. A section with nothing to show is not rendered.

### Header

`PageHeader` with title "Today" and the date as subtitle: `toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })`.

### On the bed

One `PrintingCard` (new, `components/builds/PrintingCard.tsx`) per attempt whose `outcome` is null, newest first. The overline shows a count when there is more than one.

- **Shell:** the same as `Card`: `bg-cream shadow-soft rounded-lg p-1.5`, `hover:shadow-raised hover:bg-lifted`. The card links to the build; its buttons sit above the link, as in `AttemptEntry`.
- **Picture:** `aspect-4/3 rounded-md`. Use the build's hero photo. Without one, use the slicer plate picture (`fileUrl(file.id, "thumb")`) with `fit="contain"` on `bg-well`. Without either, use a `NoteFace` of the build's name. `OutcomeChip outcome={null}` sits bottom left over the picture, as on `BuildCard`.
- **Body:** `px-2 pt-2.5 pb-2`, `flex flex-col gap-2.5`.
  1. Name in `font-display text-title text-ink`, two lines at most, with the starter's `Avatar size="xs"` on the right. This is the screen's focal point, so it is the one card title set in Fraunces.
  2. A `MetaList` in `text-small text-ink-faint`: "attempt 3", then the filaments from `SettingsLine` with no other settings.
  3. `PrintProgress` with its label.
  4. Right aligned: `Button variant="secondary" size="sm"` "Finish", going to the build with `finish=1`.
- **Due state:** when `PrintProgress` is due, step 4 becomes a `text-small text-ink-soft` line "How did it go?" over `OutcomePicker size="md"`. Picking an outcome goes to the build with `finish=<outcome>`.
- **Desktop:** the card is a row, picture `md:w-2/5` on the left, like the journal's `AttemptCard`.
- There is no tomato button on Today. Capture stays the one primary action.

### Pick up again

Builds in stage `building` with nothing printing, most recently touched first, four at most. When there are more, a quiet "All builds" link follows.

- **Row:** the journal's `EventRow` pattern: `-mx-1.5 p-1.5 rounded-lg hover:bg-ink/4 pressable focus-ring flex items-center gap-3.5`.
- **Thumbnail:** `size-12 rounded-md`, the build's hero photo, else a `bg-ink/5` tile with `BuildsIcon`.
- **Line 1:** the name, `text-body text-ink font-semibold truncate`.
- **Line 2:** a `MetaList` in `text-small text-ink-faint`: the last outcome as a word in its own ink (`text-tomato-ink` "Spaghetti", `text-semolina-ink` "Partly", `text-basil-ink` "Worked"), the first failure tag when there is one, then the relative time. A build with no attempts says "No attempts yet".
- **Right:** `OutcomeStrip` without `onPick`.

### In the printer

A compact, read-only view of what is loaded. The overline row has a quiet "Pantry" link on the right, and the whole strip also links to `/pantry`.

- One row of `SpoolDisc size="md"` per slot, each with its slot id under it in `text-caption text-ink-faint tabular`. Empty slots use `empty`.
- A `w-px h-8 bg-hairline` divider separates AMS units and the external spool. On phones the row scrolls sideways with `no-scrollbar` when it doesn't fit.
- Under it, at most two lines in `text-small`, each led by a `RemainingMeter`: "Sunflower yellow in A2 is running low" or "Gray in A3 is empty". Only loaded spools are listed. With none low, there is no line.

### Lately

The journal's head: the month in one sentence, then the three newest entries.

- The overline is the month label the journal uses ("November so far"). Under it, the month's summary sentence in `font-display text-title text-ink`. Reuse the journal's summary code; don't write the sentence twice.
- Then the three newest journal entries as rows. Give `JournalEntry` a `compact` prop so attempts render as rows too: `size-12` thumbnail, the outcome's icon and word in its ink, the time, then the build's name and "attempt 2".
- Skip entries for an attempt already shown under On the bed.
- End with `Button variant="quiet" size="sm"` "See the whole journal".

### On the back burner

One old idea resurfaces each day, so the inbox doesn't become a graveyard.

- Candidates are ideas older than 14 days. Pick index = a hash of the local date (`YYYY-MM-DD`) modulo the count, so both people see the same idea all day.
- Layout: a small portrait card on the left (`w-28`, 4:5, photo or `NoteFace`), and on the right the name (`text-body font-semibold line-clamp-2`), "Alex · 5 weeks ago" in `text-small text-ink-faint`, and `Button variant="secondary" size="sm" icon={BuildsIcon}` "Start building".
- The block links to the idea. "Start building" runs the same action as the idea page.

### Desktop layout

From `lg`, two columns inside `max-w-wide` with `gap-10 lg:gap-14`, matching the build page.

```
Today
Tuesday, November 10

ON THE BED                         | IN THE PRINTER        Pantry
+-------------------------------+  | (O)(O)(O)(O) | (O)
| [picture] Bath tugboat   (A)  |  | Sunflower yellow in A2 is low
|           attempt 3 . PLA     |  |
|           ======------        |  | NOVEMBER SO FAR
|           45 min left [Finish]|  | 10 prints, 3 spaghetti...
+-------------------------------+  | [#] Finished after 3 attempts
                                   | [#] Captured an idea
PICK UP AGAIN                      | See the whole journal
[#] Cable chain            o       |
[#] Hook for the desiccant o o     |
                                   |
ON THE BACK BURNER                 |
[note] Replacement knob...         |
```

- Main column `flex-3 min-w-0`: On the bed, Pick up again, On the back burner.
- Side column `flex-2 min-w-0 lg:sticky lg:top-8`: In the printer, Lately.
- Between `md` and `lg`: one column in the phone order.

### States

| State | What shows |
| --- | --- |
| Loading | One `CardSkeleton` (landscape) and three `RowSkeleton`s. Sections appear as their own query resolves. |
| Brand-new workspace (no ideas, no builds) | `EmptyState` with the EmptyPot illustration, title "Nothing on the stove yet", body "Capture an idea or start a build. What's printing and what to pick up next will show here.", action "New idea". |
| Offline | Everything is readable from the saved copy. "Finish" still works, because finishing goes through the outbox. "Start building" is disabled through `useReadOnly`. |

### Also

- Command palette: with something printing, `useScreenActions("Today", …)` offers "Finish attempt 3 of Bath tugboat for Mila".
- Today is now the first screen, so add it to `e2e/performance.spec.ts` with the same first-load budget as Ideas. Every picture on it is a `thumb`.

## 3. Build page

The build page gets a summary of the whole build under its notes, attempt photos that line up down the story, and a side-by-side comparison of two attempts. Size: medium. Server work: none.

### Summary under the notes

On desktop the left column ends after the note, and stays empty while the story scrolls beside it. A summary fills it with what the story adds up to.

- **Where:** in `routes/_app/builds.$buildId.tsx`, between the `NoteField` and `WhatWorked`, on phones and desktop alike. Show it from the second attempt on; with one attempt it only repeats the story.
- **Component:** a new `components/builds/BuildSummary.tsx`. It has no surface of its own: it is reference text on paper, `flex flex-col gap-2 mt-2`.
- **Overline:** "So far" while the build is open, "In all" once it is done or shelved.

| Row | Content | Rules |
| --- | --- | --- |
| 1 | `OutcomeStrip` with `onPick`, then words in `text-small text-ink-soft`: "1 spaghetti, 1 partly, printing now" | Picking a dot selects that attempt and scrolls to it, exactly as `J` and `K` do |
| 2 | A `MetaList` in `text-small text-ink-soft tabular`: "6 h 22 min on the bed", "130 g of filament" | Time sums `actualMinutes`, falling back to `estimatedMinutes`, and then reads "about 6 h 22 min". Weight sums `weightGrams`, and reads "at least 130 g" when some attempts have none. A figure with no data is left out. |
| 3 | Every filament used, as `Swatch` plus name, four at most, then "+2 more" | Unique by `spoolId`, else by type and color. One with a `spoolId` links to `/pantry/$spoolId`. |

Put the sums in a pure `summarizeBuild(attempts)` in `src/shared/attempts.ts` and unit-test it, including the "about" and "at least" cases.

### Attempt photos line up

In `AttemptEntry`, a single photo is capped at `md:max-w-md` and a set at `md:max-w-xl`, so the lead photo changes size from one entry to the next. Make the lead photo the same size in every entry.

- **Desktop:** the lead photo is always `aspect-4/3` at `md:max-w-md`. Extra photos are a `md:w-32` column to its right with `gap-2`, as tall as the lead, two tiles at most, the second carrying the existing "+N" veil.
- **Phone:** unchanged.

### Compare two attempts

The change chips say what was tried differently. Comparing shows whether it helped, which is the question the app exists to answer.

**Ways in**

- In `AttemptEntry`, the changes line becomes a button: the same semolina chips, then a quiet "Compare" with `CompareIcon` (Phosphor `Columns`, added to `ui/icons.tsx`). Give it `pointer-events-auto relative z-10`, like the file card, so it sits above the entry's open button.
- An attempt with a predecessor but no setting changes shows only the quiet button, reading "Compare with attempt 1".
- Desktop: a new shortcut `buildCompare`, key `v`, group `build`, label "Compare with the attempt before". The palette offers "Compare attempt 3 with attempt 2" under "This build".

**Surface**

A `Sheet`: the centered dialog on desktop, through a new size="wide" prop on Sheet, at `max-w-4xl`, a full-height bottom sheet on phones. Title "Attempt 2 and attempt 3", older first. Description: the build's name.

**Desktop layout**

```
Attempt 2 and attempt 3                                   x
Bath tugboat for Mila

(Partly) Attempt 2 v   Yesterday | (Worked) Attempt 3 v  Today
+-----------------------------+  | +------------------------+
|        photo 4:3            |  | |       photo 4:3        |
|        contain              |  | |       contain          |
+-----------------------------+  | +------------------------+
[t][t][t]                        | [t][t]
Stayed down, stern curled.       | Clean all the way up.
(Warping) (Great first layer)    | (Great first layer)

WHAT CHANGED
Bed            60 C         [65 C]
Chamber        none         [35 C]
Filament       not dried    [dried]

> Same in both (7)

HOW IT WENT
Time           3 h 17 min    3 h 02 min
Filament       66 g          66 g
```

- **Columns:** `grid grid-cols-2 gap-4`. Each header has the `OutcomeChip`, "Attempt N" in `text-body font-semibold`, and the relative date in `text-small text-ink-faint`.
- **Switching:** on desktop the attempt's name is a `Popover` trigger listing every attempt (outcome dot, "Attempt N", outcome word). Picking one swaps that column. The older attempt always sits on the left.
- **Photo:** the lead photo, `aspect-4/3`, `fit="contain"` on `bg-paper-deep rounded-md`. Prints people study are never cropped. With more photos, a row of `PhotoThumb size="sm"` under it picks which one shows. With none, a `bg-well` tile with `ImageIcon` and "No photo" in `text-small text-ink-faint`.
- **Under the photo:** the note in `text-body text-ink`, then the tag chips as in the story.
- **What changed:** an `Overline`, then one row per changed setting in three columns: label (`text-small text-ink-faint`), before and after (`text-small text-ink tabular`). The after cell carries the change highlight: `bg-semolina-soft/70 rounded-xs px-1`. Rows are separated by space, not lines.
- **Same in both:** a `Disclosure` with the count, holding the unchanged settings as one `MetaList`.
- **How it went:** time taken, filament used and where it failed, side by side with no highlight. These are results, not choices.

Add a structured `diffSettings(before, after)` to `src/shared/attempts.ts` that returns `{ key, label, before, after, changed }` for every known setting. Derive `describeChanges` from it so the chips and this table can never disagree.

**Phone layout**

One photo at full width, with a `SegmentedControl` above it: "Attempt 2" and "Attempt 3". Switching crossfades the photo in place over `duration-fast`, so the eye stays on the same spot. Swiping the photo sideways switches too. The chosen attempt's chip, note and tags follow, then the same three-column table. Phones compare an attempt with the one before it; there is no picker.

**Edges**

- An attempt that is still printing can be compared: it shows the Printing chip and no results.
- With reduced motion the photo swaps without a fade.

## 4. Idea page

The idea page takes the build page's proportions, and links in a note become cards. Size: medium. Server work: one small endpoint for link titles.

### Proportions

On desktop the photo column is `md:flex-3` and the text `md:flex-2`, so a very large photo sits beside three lines of text.

- In `routes/_app/ideas.$ideaId.tsx`, swap them: photos `md:flex-2`, text `md:flex-3`, with the build page's gaps (`md:gap-10 lg:gap-14`). Keep the text at a readable measure with `max-w-content`.
- An idea that becomes a build then keeps its photo in the same place at the same size, and the attempts take the side the text had. "Start building" reads as the page growing, not changing.
- Without photos, and on phones, nothing changes.

### Link cards

A link in a note is often the whole idea: a model page. It is an underlined URL today.

- **Where:** under the `NoteField` on the idea page and the build page. One card per distinct link in the note, in order, three at most. `findLinks` in `src/shared/links.ts` already finds them. The links in the note stay as they are.
- **Component:** a new `src/client/components/ui/LinkCard.tsx`.

```
+--------------------------------------------+
| [P]  Drawer bins, 42 mm grid            ^  |
|      printables.com                        |
+--------------------------------------------+
```

| Part | Spec |
| --- | --- |
| Shell | An `<a target="_blank" rel="noreferrer noopener">` with `bg-cream shadow-soft rounded-lg p-3 flex items-center gap-3 min-h-16 pressable focus-ring hover:shadow-raised` |
| Site tile | `size-10 rounded-sm bg-ink/5 text-ink-soft font-display text-title`, the site's first letter in upper case, `aria-hidden` |
| Title | `text-body text-ink font-semibold line-clamp-2`. Until a title arrives, and when none does: `shortUrl(url)` |
| Site | `text-small text-ink-faint truncate`: the site name, else the host |
| Mark | `ExternalIcon` (Phosphor `ArrowUpRight`) at 16 px in `text-ink-faint`, top right |

- **Loading:** the card shows at once with the short URL. The title fades in over `duration-fast` when it arrives. `min-h-16` keeps the height steady, so nothing jumps and there is no skeleton.
- **No remote images in this version.** They break offline, leak the visit to the other site and shift the layout. A later version can store a preview picture in R2 the way photos are stored.
- Idea cards in the inbox don't change.

### Endpoint

`GET /api/links/preview?url=` returns `{ url, title, site }`, with `title` and `site` nullable.

- Signed-in people only. `https:` only. Refuse hosts that are IP addresses, `localhost`, or end in `.local` or `.internal`: the container can reach the home network.
- A 3-second timeout, at most 256 KB read, `text/html` only, three redirects at most with each hop checked the same way.
- Title from `og:title`, else `<title>`; site from `og:site_name`. Trim both to 200 characters.
- Cache in a new D1 table `link_previews` (`url` primary key, `title`, `site`, `fetched_at`). Refetch after 30 days; remember a failure for one day.
- Client: `linkPreviewQuery(url)` in `lib/queries.ts` with a one-day `staleTime`. Add its root to `PERSISTED_ROOTS`.
- Tests in `test/worker/`: a good page, each refused host, an oversized page, a page that isn't HTML.

## 5. Pantry

Spools show in every color, AMS slots say how much is left, spool cards stop being mostly blank, and desktop gets a list for scanning stock. Size: small to medium. Server work: none.

### Rim

The `SpoolDisc` change in section 1 fixes white and black spools everywhere. Check it on the AMS bays, the slot sheet's rows, spool cards, a spool page's hero, and Today's strip, in both themes.

### AMS slots say what is left

In `components/pantry/Ams.tsx`, only the external row shows a `RemainingMeter`. The four bays show a small disc in a large empty tile on desktop.

| Width | Bay layout | Content, top to bottom or left to right |
| --- | --- | --- |
| Below `lg` | Vertical, as today | Disc `lg`, slot id, name, material, then a new `RemainingMeter` centered with `mt-1` |
| `lg` and up | A row, like the external holder: `flex items-center gap-3 px-3 py-3 text-left` | Disc `lg` on the left. Text block: slot id caption, name in `text-small font-semibold truncate`, a material line, `RemainingMeter showLabel` |

- The four bays stay in `grid-cols-4`. On desktop each tile is now filled edge to edge and about a third shorter.
- **Dried:** from `lg`, when `spool.driedAt` is set, the material line becomes a `MetaList`: "PETG", then `DriedIcon` at 12 px with "12 d ago". A spool never dried shows only the material. This states a fact; it is not a warning.
- **Empty spool still loaded:** the meter shows its label ("Empty") at every width.
- The external row gets `showLabel` from `lg`, to match.

### Spool cards: the spool is the picture

A `SpoolCard` without a label photo shows a 96 px disc in a square well, which is mostly blank at desktop widths. Use `SpoolDisc size="fill"` there, so the spool fills three fifths of the well at any card size. Keep the `bg-ink/3` well and the `group-hover:rotate-12` turn. Cards with a photo don't change.

### List view on desktop

Past a dozen spools, a grid of cards is slow to scan for what is running low.

- **Switch:** add a heading row above the material groups in `routes/_app/pantry.index.tsx`: `SectionHeading` "All spools" with the count, and on the right a `SegmentedControl` with "Cards" and "List". Desktop only; phones always show cards. Remember the choice per device in `localStorage` under `sg-pantry-view`, the way `sg-theme` is kept.
- **Groups:** as in the card view, by material. Each group is an `Overline` with its count over one `bg-cream shadow-soft rounded-lg` surface. Rows inside it are separated by `bg-hairline`, the one place the design language allows a line.
- **Order in a group:** low, half, full, then empty spools at `opacity-60`.

```
PLA 8
+----------------------------------------------------------------+
| (O) Sunflower yellow     |.. Low    (A2)       dried 12 d ago  |
|     Bambu PLA                                                   |
|----------------------------------------------------------------|
| (O) Jade white           ||. Half   (A1)                       |
|     Bambu PLA                                                   |
+----------------------------------------------------------------+
```

| Column | Spec |
| --- | --- |
| Row | A link to the spool: `h-16 px-4 flex items-center gap-4 hover:bg-ink/4 focus-ring`. Draggable onto AMS slots with `spoolDragProps`, like a card |
| Spool | `SpoolDisc size="md"` |
| Name | `flex-1 min-w-0`: title in `text-body text-ink font-semibold truncate`, detail under it in `text-small text-ink-faint truncate` (both from `spoolName`) |
| Left | `RemainingMeter showLabel` in a `w-24` column |
| Loaded | `Chip tone="semolina"` with the slot, in a `w-20` column; empty when not loaded |
| Dried | `DriedIcon` and "12 d ago" in `text-small text-ink-faint tabular`, in a `w-28` column; empty when never dried |

There is no header row: each column explains itself with an icon or a word.

## 6. Journal

Two kinds of entry get clearer: a row without a photo stops showing its icon twice, and a print in progress shows a picture and how far along it is. Size: small. Server work: none. Journal items come from the same loader as item pages, so each attempt already carries its `file`.

### One icon per row

In `components/journal/JournalEntry.tsx`, an `EventRow` without a photo draws the event's icon in a `size-12` tile, then draws it again at 15 px before the label ("Captured an idea").

- When the tile shows the icon, the label drops its inline icon.
- When a photo fills the tile, the inline icon stays: it is then the only mark of what kind of event this is.
- This applies to all four kinds: idea, started, finished, shelved. The finished row keeps its `bg-basil-soft` tile.

### Attempt cards without a photo

An `AttemptCard` with no photo is text only today. That includes the print in progress, which sits at the top of the journal.

- **Plate picture:** when the attempt has `file?.hasThumb`, show the plate picture in the photo slot. Use the same `aspect-4/3 md:w-2/5 rounded-md` frame, on `bg-well` with `fit="contain"` and `p-3`, because it is a render and not a photo.
- **Say what it is:** a badge top left reads "Slicer preview": `bg-veil text-on-veil text-caption font-semibold rounded-pill h-6 px-2`, led by the file glyph `FromFileMark` uses. Nobody should take it for a photo of the result.
- The `OutcomeChip` sits bottom left, as it does over photos.
- **Printing:** add `PrintProgress` with its label in the text column, between the title row and the settings line.
- With neither photo nor file, the card stays as it is.

### Compact rows

The `compact` prop that Today's Lately section needs (section 2) belongs in this file. Build it here so the journal and Today can never drift apart.

## 7. Navigation

Today becomes the first destination on both layouts, search becomes a tool in the phone header, the sidebar shows what is printing, and the styleguide leaves the main navigation. Size: small to medium. Server work: none.

### Phone tab bar

|  | Slot 1 | Slot 2 | Middle | Slot 4 | Slot 5 |
| --- | --- | --- | --- | --- | --- |
| Now | Ideas | Builds | Capture | Journal | Search |
| New | Today | Ideas | Capture | Builds | Journal |

The rule behind it: tabs are places, search is a tool.

- `TabBar.tsx` reads `sections` as a fixed four-tuple. In `sections.ts`, export `tabs` (Today, Ideas, Builds, Journal) for the tab bar and keep `sections` (Today, Ideas, Builds, Journal, Search) for the sidebar, hotkeys and palette.
- The active tab keeps its look: filled icon, `text-tomato-ink` label.

### Search on phones

- `PageHeader` gets an `IconButton` with `SearchIcon`, label "Search", `variant="quiet"`, to the left of the account avatar, on every top-level page except Search itself. It is `md:hidden`.
- It links to `/search`, which focuses the box and raises the keyboard as the tab did.
- Detail pages keep their `DetailBar` as it is.

### Pantry and Printer on phones

They stay as the first rows of the account sheet. Today's "In the printer" strip is the new fast way to the Pantry.

### Sidebar

- Today is the first item, with its `G T` hint. The mark and "Spaghetti" link to `/today`.
- **Now printing:** when an attempt is printing, a small card sits at the bottom of the sidebar, above the account button. It is hidden on Today, which already shows the print.

```
+------------------------------+
| [#] Bath tugboat for Mila    |
|     (o) 45 min left          |
+------------------------------+
```

| Part | Spec |
| --- | --- |
| Shell | A link to the build: `bg-cream shadow-soft rounded-md p-2 flex items-center gap-2.5 pressable focus-ring hover:shadow-raised` |
| Thumbnail | `size-9 rounded-sm`: the build's hero photo, else a `bg-ink/5` tile with `BuildsIcon` |
| Name | `text-small text-ink font-semibold truncate` |
| Second line | `PrintProgress variant="ring"` and its label in `text-caption text-ink-faint tabular`: "45 min left", "Done by now" or "On the bed" |
| Several printing | Show the one due first, then "and 1 more" in `text-caption text-ink-faint`, linking to Today |
| Motion | Arrives with a fade and a 4 px rise over `duration-base ease-out`; leaves with a fade |

- **Styleguide:** remove it from the sidebar. Put it in the account `Popover` under the theme switch, as `Button variant="quiet" icon={PaletteIcon}`. Add a "Go to Styleguide" row to `CommandPalette.tsx`; there is none today. The phone account sheet keeps its row.

### Shortcut

`goToday` with keys `g t`. The `?` overlay and the sidebar hint read it from the registry, and the existing unit test guards against a clash.

## 8. Motion

Four additions make the app feel continuous: photos travel from a card to its page, an outcome answers the tap, lists reflow when a print finishes, and the attempt sheet steps between attempts. None delays content, and all of them stop under reduced motion. Size: medium. Server work: none.

### Photos travel from card to page

Opening an idea or build today swaps the whole screen. The photo should grow from the card into the page's hero.

- Use the View Transitions API through the router's `viewTransition` option, which the installed TanStack Router supports. It needs no new dependency.
- Apply it to links from `Card` (ideas and builds), journal entries, search results and Today's rows.
- **Name one photo only.** On click, set `viewTransitionName: "hero-photo"` on the tapped card's photo, then navigate. The detail page gives the same name to its hero when the hero is that same photo id. Clear the name when the transition ends. A fixed name on every card fails, because the journal can show one photo twice and duplicate names cancel the transition.
- When the hero is a different photo, let the page crossfade.

| What | Timing |
| --- | --- |
| `::view-transition-group(hero-photo)` | `var(--sg-duration-base)` with `var(--sg-ease-out)` |
| `::view-transition-old(root)` and `::view-transition-new(root)` | `var(--sg-duration-fast)` |
| Reduced motion | `animation: none` on every view-transition pseudo-element, in the existing reduced-motion block of `styles/app.css` |
| Browsers without the API | Nothing happens. No polyfill. |

### An outcome answers the tap

- In `OutcomePicker`, the picked button's icon springs from `scale: 0.8` to `1` with `spring.snappy`. Wrap the icon in `m.span` keyed on being selected.
- On phones, add a 10 ms vibration through a new `lib/haptics.ts` with one function, `tap()`. It calls `navigator.vibrate?.(10)` and does nothing under reduced motion or where the API is missing.

### Lists reflow when a print finishes

- On Today, a finished `PrintingCard` leaves through `AnimatePresence`: a fade with `scale: 0.98` over `duration.base`.
- Its build then appears under "Pick up again" with `layout="position"` and `spring.gentle`, the same way `IdeaCard` and `AttemptEntry` already move.

### The attempt sheet steps between attempts

- When a saved attempt is open and the build has more than one, the sheet's header shows two `IconButton size="sm"`: `PreviousIcon` "Previous attempt" and `NextIcon` "Next attempt". They are disabled at the ends.
- The body crossfades over `duration-fast`. Autosave makes leaving mid-edit safe.
- They don't show while logging a new attempt.

### Unchanged rules

No animation on scroll, no entrance longer than `duration-slow`, `m.*` inside `LazyMotion`, and `scrollBehavior()` for any scrolling from JS.

## 9. Small polish

Four one-file fixes that can ship together. Size: small. Server work: none.

| Where | Now | Change |
| --- | --- | --- |
| `ui/Card.tsx`, a photo card with no title | The note stands in for the title and is cut at two lines mid-thought ("Found this on the bed this…") | Clamp an untitled note at three lines (`line-clamp-3`). Real titles stay at two. |
| `builds/BuildCard.tsx`, a build that is printing | The meta line reads "Attempt 3 · 52 min ago" | Use the `printProgress` label instead of the relative time: "Attempt 3 · about 45 min left", or "Attempt 3 · should be done by now" |
| `routes/_app/pantry.$spoolId.tsx`, Material and Finish chips on desktop | Each row wraps with one orphan chip on a second line ("PVA", "Wood") | Show the first six, plus the picked one if it isn't among them, then a "4 more" chip that opens the rest. `TagPicker` already does this with "11 more"; reuse its logic. |
| `journal/Filters.tsx`, the desktop filter column | Failure tags and success notes share one group, "Tags" | Two `FilterGroup`s: "What went wrong" and "What went right", the wording the attempt sheet uses. The chips keep their tomato and basil tones when picked. |

## 10. Definition of done

A section is done when every box that applies to it is ticked.

**Look at it**

- [ ] New screens and states are in `scripts/screenshot-routes.ts`: `today`, `today-due`, `today-empty`, `compare`, `pantry-list`, `idea-links`, `journal-printing`.
- [ ] The seed in `scripts/seed/` covers them: a printing attempt with an estimate and a slicer file, one whose estimate has passed, a build with three attempts that have times and weights, an idea older than 14 days, a white and a black spool loaded in the AMS, and a note with a link.
- [ ] `pnpm screenshots` and `pnpm screenshots --dark` were run, and every changed screen was looked at, at 390 px and 1440 px. The pictures are in the pull request.

**Design system**

- [ ] `/styleguide` shows each new piece: `PrintProgress` in its three states as bar and ring, `SpoolDisc` tones and `fill`, `OutcomeStrip`, `LinkCard`, `PrintingCard`, the pantry list row and the compare table.
- [ ] `docs/design.md` describes them, and gains Today, the new tab bar, header search, the sidebar's printing card, the view-transition rule and "one icon per row".
- [ ] New text and surface pairs are in `scripts/lib/contrast.ts` and pass in both themes. The one known gap is an outcome word in `basil-ink` on paper and on cards; `semolina-ink` and `tomato-ink` on those surfaces are already listed.
- [ ] No lint exceptions were added beyond the existing one for a filament's color.

**Accessibility**

- [ ] `e2e/accessibility.spec.ts` covers Today, the compare sheet and the pantry list, at both widths and in both themes.
- [ ] Every new control is named by its visible text, has a 44 px target on touch screens, and shows the ink focus ring.
- [ ] Every state reads without color: progress has a label, outcomes have a word, the strip has its sentence.
- [ ] With reduced motion, nothing transitions and nothing vibrates.

**Behavior**

- [ ] Unit tests cover `printProgress`, `colorTone`, `summarizeBuild`, `diffSettings` and the daily pick for the back burner.
- [ ] End-to-end tests cover: Today shows the printing build and "Finish" opens its sheet; compare opens from the changes line and with `V`; the pantry's list choice survives a reload.
- [ ] Today opens offline from the saved copy, and the read-only rules hold on every new control.
- [ ] Today has a first-load budget in `e2e/performance.spec.ts`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm test:e2e` pass.
