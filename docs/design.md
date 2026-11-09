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
| `well`                                         | Photo placeholders, skeletons. Fields use `bg-ink/4`, which reads as a well on paper and on cream. |
| `ink` / `ink-soft` / `ink-faint` / `ink-ghost` | Headings and text / body and labels / meta and hints (AA on paper) / placeholders and disabled.    |
| `tomato`                                       | The one action color. One primary (tomato) button per screen. Also the focus ring.                 |
| `basil`                                        | Success: a print that worked, "Saved".                                                             |
| `semolina`                                     | Highlight and in-progress: printing now, selections.                                               |
| `*-soft` / `*-ink`                             | Background and text pairs for chips and quiet states (`bg-basil-soft text-basil-ink`).             |
| `person-*`                                     | Each person's color (tomato, basil, semolina, plum, sea, clay), for avatars and authorship.        |

Accents are spice, not sauce: most of a screen is paper, cream and ink.

**Dark mode** is defined (`[data-theme="dark"]` in tokens.css) but not switched on yet. Because everything uses tokens, turning it on is a matter of setting the attribute; check new tokens in both themes.

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
- Desktop: the sidebar is `w-sidebar` (16 rem); content sits in `max-w-wide` (72 rem) with `px-12`; long text in `max-w-content` (45 rem).
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

A hairline (`bg-hairline`) is allowed only where a shadow can't work, such as between rows inside one surface.

## Motion

- Durations: `duration-instant` (90 ms, press), `duration-fast` (160 ms, hover and fades), `duration-base` (240 ms, sheets in), `duration-slow` (420 ms, entrances). Easing: `ease-out` for things arriving, `ease-in-out` for things leaving or looping.
- In JS (`motion`), use `src/client/lib/motion.ts`: the same durations and easings, plus springs for things under a finger.
- Everything tappable gets `pressable`: it shrinks to 97% while held.
- Focus: `focus-ring`, a soft tomato ring for keyboard focus only.
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
- **Toast** — `toast.undo(message, { onUndo })` after any delete. Also `toast.success`, `toast.error`, `toast.message`. Phones show toasts above the tab bar.
- **EmptyState** — illustration, a title with a small pasta joke, one plain sentence on what goes here, one next step.
- **Card** — photo first, optional title (the note stands in), chips over the photo, meta line, author avatar.
- **Chip / ToggleChip** — status and material labels in four tones; ToggleChip for filters.
- **Avatar / AvatarStack** — initials on the person's color.
- **Skeleton / CardSkeleton / RowSkeleton** — loading states shaped like the content.
- **Kbd** — keyboard hints, hidden on phones.
- **Illustrations** (`components/illustrations`) — 160×120 spot illustrations: ink outlines at 2.5 px, round caps, one tinted circle behind, one or two accent fills. The `Mark` is the app icon: a twirl of spaghetti on a tomato tile.

## App shell

- **Phone (< 768 px):** a page header with a large title and the account avatar; a bottom tab bar (Ideas, Builds, capture, Journal, Search) with the capture button in the middle.
- **Desktop:** a fixed left sidebar on `paper-deep` with the mark, a "New idea" button, the four sections with keyboard hints, the styleguide and the signed-in person.
- **Keyboard (desktop):** `C` capture, `G I` Ideas, `G B` Builds, `G J` Journal, `/` Search. Shortcuts are ignored while typing or while a sheet is open.

## Voice

Short, warm, plain. Second person, sentence case, no exclamation marks. A pasta joke is welcome in an empty-state title or a toast, once per screen at most ("Nothing simmering yet", "Nothing on the bed"); the sentence after it says plainly what to do. Failures are not errors: a failed print is "spaghetti", recorded with the same care as a success.

## Rules for new UI

1. Use tokens and shared components only. No hex colors, no `text-[13px]`, no one-off shadows: `pnpm lint` checks (`scripts/check-design.ts`).
2. If a screen needs something the system lacks, add it to the system (a token or a component in `components/ui`), document it here, and show it in `/styleguide`.
3. Design both layouts: check every screen at 390 px and 1440 px with `pnpm screenshots`, and look at the result before calling it done.
4. Loading is a skeleton, saving is automatic, deleting is undoable.
