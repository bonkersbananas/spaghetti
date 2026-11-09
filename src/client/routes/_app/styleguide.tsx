import type { Person } from "@shared/api";
import { createFileRoute } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import dragonPhoto from "@/assets/samples/dragon.svg";
import planterPhoto from "@/assets/samples/planter.svg";
import vasePhoto from "@/assets/samples/vase.svg";
import { EmptyPot, Mark, NoodleSearch, OpenNotebook, SpoolStrand } from "@/components/illustrations";
import { OfflineBanner } from "@/components/shell/OfflineNotice";
import { PageHeader } from "@/components/shell/PageHeader";
import { ThemeSwitch } from "@/components/shell/ThemeSwitch";
import { Avatar, AvatarStack } from "@/components/ui/Avatar";
import { Button, IconButton } from "@/components/ui/Button";
import { Card, PhotoCountBadge } from "@/components/ui/Card";
import { Chip, ToggleChip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { TextArea, TextField } from "@/components/ui/Field";
import * as Icons from "@/components/ui/icons";
import { Kbd } from "@/components/ui/Kbd";
import { NoteField } from "@/components/ui/NoteField";
import { Photo } from "@/components/ui/Photo";
import { AddPhotoTile, PhotoThumb } from "@/components/ui/PhotoTiles";
import { type SaveState, SaveStatus } from "@/components/ui/SaveStatus";
import { Sheet } from "@/components/ui/Sheet";
import { CardSkeleton, RowSkeleton, Skeleton } from "@/components/ui/Skeleton";
import { toast } from "@/components/ui/Toast";
import { ProgressRing, UploadBadge } from "@/components/ui/UploadBadge";
import { cn } from "@/lib/cn";

export const Route = createFileRoute("/_app/styleguide")({
  component: Styleguide,
});

/**
 * Every token and shared component, live. When you add to the design
 * system, add it here too: reviews and later sessions start from this page.
 */
const toc = [
  ["color", "Color"],
  ["appearance", "Dark & offline"],
  ["type", "Type"],
  ["space", "Space & radii"],
  ["elevation", "Elevation"],
  ["motion", "Motion"],
  ["icons", "Icons"],
  ["buttons", "Buttons"],
  ["fields", "Fields"],
  ["chips", "Chips"],
  ["avatars", "Avatars"],
  ["cards", "Cards"],
  ["photos", "Photos"],
  ["sheets", "Sheets & toasts"],
  ["empty", "Empty states"],
  ["skeletons", "Skeletons"],
] as const;

const people: Person[] = [
  { id: "a", username: "alex", name: "Alex Rivera", color: "tomato" },
  { id: "b", username: "sam", name: "Sam", color: "sea" },
];

function Styleguide() {
  return (
    <>
      <PageHeader title="Styleguide" subtitle="The kitchen's tools: every token and component, live." />
      <div className="flex gap-12">
        <nav aria-label="Styleguide sections" className="sticky top-8 hidden h-fit w-40 shrink-0 flex-col lg:flex">
          {toc.map(([id, label]) => (
            <a
              key={id}
              href={`#${id}`}
              className="focus-ring text-small text-ink-faint hover:text-ink rounded-xs px-2 py-1.5 font-medium"
            >
              {label}
            </a>
          ))}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col gap-16 pb-10">
          <ColorSection />
          <AppearanceSection />
          <TypeSection />
          <SpaceSection />
          <ElevationSection />
          <MotionSection />
          <IconSection />
          <ButtonSection />
          <FieldSection />
          <ChipSection />
          <AvatarSection />
          <CardSection />
          <PhotoSection />
          <SheetSection />
          <EmptySection />
          <SkeletonSection />
        </div>
      </div>
    </>
  );
}

function Section({ id, title, note, children }: { id: string; title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-8">
      <h2 className="text-headline text-ink">{title}</h2>
      {note && <p className="max-w-content text-body text-ink-soft mt-1">{note}</p>}
      <div className="mt-6">{children}</div>
    </section>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <p className="text-caption text-ink-faint mb-3 font-semibold tracking-wider uppercase">{children}</p>;
}

function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("bg-cream shadow-soft rounded-lg p-5 md:p-6", className)}>{children}</div>;
}

/* Color ------------------------------------------------------------------ */

const swatchGroups: Array<{ label: string; swatches: Array<[token: string, className: string, note: string]> }> = [
  {
    label: "Surfaces",
    swatches: [
      ["paper", "bg-paper", "The page"],
      ["paper-deep", "bg-paper-deep", "Sidebar, recessed areas"],
      ["cream", "bg-cream", "Cards, the tab bar, fields"],
      ["lifted", "bg-lifted", "Sheets, dialogs, menus"],
      ["well", "bg-well", "Photo placeholders, skeletons"],
    ],
  },
  {
    label: "Ink",
    swatches: [
      ["ink", "bg-ink", "Text, headings"],
      ["ink-soft", "bg-ink-soft", "Body copy, labels"],
      ["ink-faint", "bg-ink-faint", "Meta, hints (AA on paper)"],
      ["ink-ghost", "bg-ink-ghost", "Placeholders, disabled"],
    ],
  },
  {
    label: "Over photos and inverse",
    swatches: [
      ["veil", "bg-veil", "Badges and buttons on photos"],
      ["veil-strong", "bg-veil-strong", "Upload badge, remove buttons"],
      ["select", "bg-select", "A selected chip"],
      ["toast", "bg-toast", "Toasts"],
      ["scrim", "bg-scrim", "Behind sheets"],
      ["hairline", "bg-hairline", "Between rows, rarely"],
    ],
  },
  {
    label: "Accents",
    swatches: [
      ["tomato", "bg-tomato", "The one action color"],
      ["tomato-soft", "bg-tomato-soft", "Danger, failed prints"],
      ["basil", "bg-basil", "Success, done"],
      ["basil-soft", "bg-basil-soft", "Success backgrounds"],
      ["semolina", "bg-semolina", "Highlights, in progress"],
      ["semolina-soft", "bg-semolina-soft", "Highlight backgrounds"],
    ],
  },
  {
    label: "People",
    swatches: [
      ["person-tomato", "bg-person-tomato", ""],
      ["person-basil", "bg-person-basil", ""],
      ["person-semolina", "bg-person-semolina", ""],
      ["person-plum", "bg-person-plum", ""],
      ["person-sea", "bg-person-sea", ""],
      ["person-clay", "bg-person-clay", ""],
    ],
  },
];

function AppearanceSection() {
  return (
    <Section
      id="appearance"
      title="Dark & offline"
      note="Every token has a dark value, so every screen has a night version. Switch here to check a component in both. In the dark, elevation comes from lighter surfaces and a lit top edge rather than shadow."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Panel className="flex flex-col gap-6">
          <ThemeSwitch />
          <p className="text-small text-ink-faint">
            Light, dark or follow the system, remembered per device. It lives in the account sheet on phones and the
            sidebar's account menu on desktop.
          </p>
        </Panel>
        <Panel className="flex flex-col gap-4">
          <Label>Offline notice</Label>
          <OfflineBanner waiting={0} />
          <OfflineBanner waiting={2} />
          <p className="text-small text-ink-faint">
            The one quiet place that says there is no connection. Captures wait in the outbox on this device.
          </p>
        </Panel>
      </div>
    </Section>
  );
}

function ColorSection() {
  return (
    <Section
      id="color"
      title="Color"
      note="Warm paper, ink, and accents used with restraint: one tomato action per screen, basil and semolina for state. Use only these tokens."
    >
      <div className="flex flex-col gap-8">
        {swatchGroups.map((group) => (
          <div key={group.label}>
            <Label>{group.label}</Label>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
              {group.swatches.map(([token, className, note]) => (
                <div key={token} className="bg-cream shadow-soft rounded-md p-1.5">
                  <div className={cn("shadow-well h-16 rounded-sm", className)} />
                  <div className="px-1.5 pt-2 pb-1">
                    <p className="text-small text-ink font-semibold">{token}</p>
                    {note && <p className="text-caption text-ink-faint">{note}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* Type ------------------------------------------------------------------- */

const typeScale: Array<[token: string, className: string, sample: string]> = [
  ["display", "font-display text-display", "Spaghetti"],
  ["headline", "font-display text-headline", "Nothing simmering yet"],
  ["title", "font-display text-title font-semibold", "Articulated dragon, attempt 4"],
  ["lead", "text-lead", "Stringing on the wings again; lowered the nozzle 5 °C."],
  ["body", "text-body", "PLA Basic at 0.2 mm, 15% gyroid, AMS slot 3. Came off the plate clean."],
  ["small", "text-small text-ink-soft", "2 attempts · 3 days ago"],
  ["caption", "text-caption font-semibold tracking-wider text-ink-faint uppercase", "Filament"],
];

function TypeSection() {
  return (
    <Section
      id="type"
      title="Type"
      note={
        <>
          Fraunces (soft, display) for headings, Figtree for everything you read and tap. Sizes step up on desktop and
          stay generous on phones: body is 16 px there.
        </>
      }
    >
      <Panel className="flex flex-col gap-5">
        {typeScale.map(([token, className, sample]) => (
          <div key={token} className="flex flex-col gap-1 md:flex-row md:items-baseline md:gap-6">
            <span className="text-caption text-ink-faint w-24 shrink-0 font-semibold">text-{token}</span>
            <span className={cn("text-ink", className)}>{sample}</span>
          </div>
        ))}
        <div className="flex flex-col gap-1 md:flex-row md:items-baseline md:gap-6">
          <span className="text-caption text-ink-faint w-24 shrink-0 font-semibold">tabular</span>
          <span className="tabular text-body text-ink">0.20 mm · 220 °C · 1,234 g · 03:41:07</span>
        </div>
      </Panel>
    </Section>
  );
}

/* Space & radii ---------------------------------------------------------- */

function SpaceSection() {
  const steps = ["1", "2", "3", "4", "6", "8", "12", "16"] as const;
  const widths: Record<(typeof steps)[number], string> = {
    "1": "w-1",
    "2": "w-2",
    "3": "w-3",
    "4": "w-4",
    "6": "w-6",
    "8": "w-8",
    "12": "w-12",
    "16": "w-16",
  };
  const radii = [
    ["xs", "rounded-xs"],
    ["sm", "rounded-sm"],
    ["md", "rounded-md"],
    ["lg", "rounded-lg"],
    ["xl", "rounded-xl"],
    ["pill", "rounded-pill"],
  ] as const;
  return (
    <Section
      id="space"
      title="Space & radii"
      note="A 4 px grid (Tailwind's spacing scale). Prefer generous space to lines; round corners, softer as things get bigger."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Panel>
          <Label>Spacing</Label>
          <div className="flex flex-col gap-2.5">
            {steps.map((step) => (
              <div key={step} className="flex items-center gap-4">
                <span className="tabular text-small text-ink-faint w-16">
                  {step} · {Number(step) * 4}px
                </span>
                <span className={cn("bg-tomato h-3 rounded-xs", widths[step])} />
              </div>
            ))}
          </div>
        </Panel>
        <Panel>
          <Label>Radii</Label>
          <div className="grid grid-cols-3 gap-4">
            {radii.map(([name, className]) => (
              <div key={name} className="flex flex-col items-center gap-2">
                <div className={cn("bg-semolina-soft shadow-well size-14", className)} />
                <span className="text-small text-ink-faint">{name}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </Section>
  );
}

/* Elevation -------------------------------------------------------------- */

function ElevationSection() {
  const levels = [
    ["well", "shadow-well", "Fields, wells"],
    ["soft", "shadow-soft", "Cards at rest"],
    ["raised", "shadow-raised", "Hover, focus"],
    ["float", "shadow-float", "Sheets, toasts"],
  ] as const;
  return (
    <Section
      id="elevation"
      title="Elevation"
      note="Soft, warm shadows separate surfaces instead of borders. Hairlines only where shadows can't work."
    >
      <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
        {levels.map(([name, className, note]) => (
          <div key={name} className={cn("bg-cream flex h-28 flex-col justify-end rounded-lg p-4", className)}>
            <p className="text-small text-ink font-semibold">{name}</p>
            <p className="text-caption text-ink-faint">{note}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* Motion ----------------------------------------------------------------- */

function MotionSection() {
  const [on, setOn] = useState(false);
  const durations = [
    ["instant", "duration-instant", "90 ms · press"],
    ["fast", "duration-fast", "160 ms · hover, fades"],
    ["base", "duration-base", "240 ms · sheets in"],
    ["slow", "duration-slow", "420 ms · page entrances"],
  ] as const;
  return (
    <Section
      id="motion"
      title="Motion"
      note="Quick and soft: ease-out for things arriving, a small press on everything tappable, nothing that delays reading. Reduced-motion settings turn movement off."
    >
      <Panel className="flex flex-col gap-4">
        <div>
          <Button size="sm" onClick={() => setOn((v) => !v)}>
            {on ? "Back" : "Play"}
          </Button>
        </div>
        {durations.map(([name, className, note]) => (
          <div key={name} className="flex items-center gap-4">
            <span className="text-small text-ink-faint w-40 shrink-0">{note}</span>
            <div className="rounded-pill bg-paper shadow-well relative h-8 flex-1">
              <span
                className={cn(
                  "bg-tomato absolute top-1 left-1 size-6 rounded-full transition-transform ease-out",
                  className,
                  on && "translate-x-40 md:translate-x-80",
                )}
              />
            </div>
            <span className="sr-only">{name}</span>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <span className="text-small text-ink-faint">Press and hold:</span>
          <button
            type="button"
            className="pressable focus-ring bg-paper text-small shadow-soft rounded-md px-4 py-2.5 font-semibold"
          >
            .pressable
          </button>
        </div>
      </Panel>
    </Section>
  );
}

/* Icons ------------------------------------------------------------------ */

function IconSection() {
  const entries = Object.entries(Icons).filter(([name]) => name.endsWith("Icon")) as Array<[string, Icons.Icon]>;
  return (
    <Section
      id="icons"
      title="Icons"
      note={
        <>
          Phosphor, regular weight at 20 px; fill for active navigation. Import from{" "}
          <code className="bg-ink/6 text-small rounded-xs px-1">components/ui/icons</code> only.
        </>
      }
    >
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8">
        {entries.map(([name, Icon]) => (
          <div key={name} className="bg-cream shadow-soft flex flex-col items-center gap-2 rounded-md px-2 py-4">
            <Icon size={24} className="text-ink" />
            <span className="text-caption text-ink-faint w-full truncate text-center">{name.replace(/Icon$/, "")}</span>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* Buttons ---------------------------------------------------------------- */

function ButtonSection() {
  return (
    <Section
      id="buttons"
      title="Buttons"
      note="Primary (tomato) for the one main action on a screen; secondary for the rest; quiet in toolbars and lists. Tap targets are 44 px on phones."
    >
      <Panel className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" icon={Icons.PlusIcon} shortcut={["C"]}>
            New idea
          </Button>
          <Button variant="secondary" icon={Icons.CameraIcon}>
            Add photo
          </Button>
          <Button variant="quiet">Cancel</Button>
          <Button variant="danger" icon={Icons.TrashIcon}>
            Delete
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" size="sm">
            Small
          </Button>
          <Button variant="primary">Medium</Button>
          <Button variant="primary" size="lg">
            Large
          </Button>
          <Button variant="primary" loading>
            Saving
          </Button>
          <Button variant="primary" disabled>
            Disabled
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <IconButton icon={Icons.CloseIcon} label="Close" />
          <IconButton icon={Icons.CameraIcon} label="Take photo" variant="secondary" />
          <IconButton icon={Icons.PlusIcon} label="New idea" variant="primary" size="lg" />
          <span className="text-small text-ink-faint hidden items-center gap-2 md:flex">
            Keyboard hints: <Kbd keys={["G", "I"]} /> <Kbd keys={["/"]} />
          </span>
        </div>
      </Panel>
    </Section>
  );
}

/* Fields ----------------------------------------------------------------- */

function FieldSection() {
  const [title, setTitle] = useState("Cable clip for the desk");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [note, setNote] = useState("Needs to fit a 6 mm cable. Try PETG so it flexes without snapping.");
  const [linkedNote, setLinkedNote] = useState(
    "Remix of https://www.printables.com/model/123-cable-clip with a wider mouth.",
  );

  function edit(setter: (value: string) => void, value: string) {
    setter(value);
    setSaveState("saving");
    window.setTimeout(() => setSaveState("saved"), 700);
  }

  return (
    <Section
      id="fields"
      title="Fields"
      note="Everything autosaves: no save buttons, just a quiet status beside the label. Plain fields read as text until you edit them."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Panel className="flex flex-col gap-5">
          <TextField
            label="Title"
            saveState={saveState}
            value={title}
            onChange={(e) => edit(setTitle, e.target.value)}
          />
          <TextArea
            label="Notes"
            value={note}
            onChange={(e) => edit(setNote, e.target.value)}
            hint="Grows as you type."
          />
          <TextField label="Nozzle temperature" defaultValue="320" error="The X2D tops out at 300 °C." />
          <TextField icon={Icons.SearchIcon} placeholder="Search…" aria-label="Search" />
        </Panel>
        <Panel className="flex flex-col gap-3">
          <Label>Plain, for writing surfaces</Label>
          <TextArea appearance="title" defaultValue="Articulated dragon" aria-label="Title" minRows={1} />
          <TextArea appearance="plain" aria-label="Note" placeholder="Jot it down…" minRows={3} />
          <Label>Note field: links stay clickable, tap the text to edit</Label>
          <NoteField value={linkedNote} onChange={setLinkedNote} />
          <Label>Save states</Label>
          <div className="flex flex-wrap gap-5">
            <SaveStatus state="saving" />
            <SaveStatus state="saved" />
            <SaveStatus state="error" />
          </div>
        </Panel>
      </div>
    </Section>
  );
}

/* Chips ------------------------------------------------------------------ */

function ChipSection() {
  const [selected, setSelected] = useState("PLA");
  return (
    <Section id="chips" title="Chips" note="Labels for status and materials; toggle chips for filters.">
      <Panel className="flex flex-col gap-5">
        <div className="flex flex-wrap gap-2">
          <Chip>Idea</Chip>
          <Chip tone="semolina" icon={Icons.ClockIcon}>
            Printing
          </Chip>
          <Chip tone="basil" icon={Icons.CheckIcon}>
            Worked
          </Chip>
          <Chip tone="tomato" icon={Icons.WarningIcon}>
            Spaghetti
          </Chip>
          <Chip icon={Icons.LayersIcon}>0.2 mm</Chip>
          <Chip icon={Icons.TemperatureIcon}>220 °C</Chip>
        </div>
        <div className="flex flex-wrap gap-2">
          {["PLA", "PETG", "TPU", "ABS"].map((m) => (
            <ToggleChip key={m} selected={selected === m} onClick={() => setSelected(m)}>
              {m}
            </ToggleChip>
          ))}
        </div>
      </Panel>
    </Section>
  );
}

/* Avatars ---------------------------------------------------------------- */

function AvatarSection() {
  return (
    <Section id="avatars" title="Avatars" note="Initials on each person's color, beside what they wrote.">
      <Panel className="flex flex-wrap items-center gap-6">
        {(["xs", "sm", "md", "lg"] as const).map((size) => (
          <Avatar key={size} person={people[0] as Person} size={size} />
        ))}
        <AvatarStack people={people} size="md" />
        <div className="flex gap-2">
          {(["tomato", "basil", "semolina", "plum", "sea", "clay"] as const).map((color) => (
            <Avatar key={color} person={{ name: color, color }} size="sm" />
          ))}
        </div>
      </Panel>
    </Section>
  );
}

/* Cards ------------------------------------------------------------------ */

function CardSection() {
  return (
    <Section
      id="cards"
      title="Cards"
      note="Photo first: the print is the content, the text supports it. Titles are optional; the note stands in."
    >
      <div className="grid grid-cols-2 items-start gap-3 md:grid-cols-3 md:gap-5 xl:grid-cols-4">
        <Card
          photo={{ src: dragonPhoto, alt: "A red articulated dragon on the print bed" }}
          title="Articulated dragon"
          meta="4 attempts · 2 days ago"
          person={people[0]}
          chips={
            <Chip tone="basil" icon={Icons.CheckIcon} className="bg-basil-soft/95">
              Worked
            </Chip>
          }
          onClick={() => toast.message("Cards open their detail in a later phase")}
        />
        <Card
          note="Hook for the AMS spool holder, the stock one rattles. Check the clearance to the wall first."
          meta="Yesterday"
          person={people[1]}
          aspect="portrait"
        />
        <Card
          photo={{ src: planterPhoto, alt: "A green planter with a small plant" }}
          title="Planter with drainage"
          meta="Printing · attempt 2"
          person={people[1]}
          chips={
            <Chip tone="semolina" icon={Icons.ClockIcon} className="bg-semolina-soft/95">
              Printing
            </Chip>
          }
        />
        <Card
          photo={{ src: vasePhoto, alt: "A gold silk-PLA vase" }}
          note="Spiral vase in silk PLA, maybe 0.6 nozzle"
          meta="Just now"
          person={people[0]}
          aspect="portrait"
          badge={<PhotoCountBadge count={3} />}
          chips={<UploadBadge state="uploading" progress={0.64} />}
        />
      </div>
    </Section>
  );
}

/* Photos ----------------------------------------------------------------- */

/** A photo's average color is data, measured from its pixels, not a design token. */
const SAMPLE_PHOTO_COLOR = "#867362"; // design-lint-ignore

function PhotoSection() {
  return (
    <Section
      id="photos"
      title="Photos"
      note="A photo shows its own average color while it loads, then fades in. Captures upload in the background: the badge says how far along they are, and “Not saved yet” while a retry waits."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Panel className="flex flex-col gap-4">
          <Label>Photo: loading, then loaded</Label>
          <div className="grid grid-cols-2 gap-3">
            {/* What a loading photo shows: its own average color. */}
            <div
              role="img"
              aria-label="A photo still loading"
              className="aspect-4/3 rounded-md"
              style={{ backgroundColor: SAMPLE_PHOTO_COLOR }} // design-lint-ignore
            />
            <Photo src={dragonPhoto} alt="A red dragon" className="aspect-4/3 rounded-md" />
          </div>
          <Label>Upload badges</Label>
          <div className="bg-paper-deep flex flex-wrap gap-2 rounded-md p-3">
            <UploadBadge state="processing" />
            <UploadBadge state="uploading" progress={0.42} />
            <UploadBadge state="waiting" />
            <span className="text-ink-soft inline-flex items-center gap-2">
              <ProgressRing value={0.7} /> <ProgressRing value={null} />
            </span>
          </div>
        </Panel>
        <Panel className="flex flex-col gap-4">
          <Label>Thumbnails and add tiles</Label>
          <div className="flex flex-wrap items-center gap-2.5">
            <PhotoThumb src={planterPhoto} alt="Planter" onRemove={() => toast.message("Removed")} />
            <PhotoThumb src={vasePhoto} alt="Vase" busy />
            <AddPhotoTile size="md" icon={Icons.CameraIcon} label="Camera" />
            <PhotoThumb size="sm" src={dragonPhoto} alt="Dragon" />
            <AddPhotoTile size="sm" icon={Icons.PlusIcon} label="Add photos" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <AddPhotoTile icon={Icons.CameraIcon} label="Take photo" />
            <AddPhotoTile icon={Icons.ImageIcon} label="From library" />
          </div>
        </Panel>
      </div>
    </Section>
  );
}

/* Sheets & toasts -------------------------------------------------------- */

function SheetSection() {
  const [dialog, setDialog] = useState(false);
  const [panel, setPanel] = useState(false);
  return (
    <Section
      id="sheets"
      title="Sheets & toasts"
      note="One overlay: a bottom sheet on phones, a dialog or side panel on desktop. Deletes happen at once and offer Undo in a toast, never an “are you sure?”."
    >
      <Panel className="flex flex-wrap gap-3">
        <Button onClick={() => setDialog(true)}>Open sheet (dialog)</Button>
        <Button onClick={() => setPanel(true)}>Open sheet (panel)</Button>
        <Button
          icon={Icons.TrashIcon}
          onClick={() =>
            toast.undo("Idea deleted", {
              onUndo: () => toast.success("Restored"),
            })
          }
        >
          Delete with undo
        </Button>
        <Button onClick={() => toast.success("Saved to Ideas")}>Success toast</Button>
        <Button onClick={() => toast.action("Saved to Ideas", { label: "View", onClick: () => undefined })}>
          Toast with an action
        </Button>
        <Button
          onClick={() =>
            toast.delight(
              "First one in the pot",
              "Every print starts as an idea like this. Add more whenever they come.",
            )
          }
        >
          First idea (delight)
        </Button>
      </Panel>
      <Sheet
        open={dialog}
        onOpenChange={setDialog}
        title="A sheet"
        description="Bottom sheet on phones, centered dialog on desktop."
        footer={
          <Button variant="primary" fullWidth onClick={() => setDialog(false)}>
            Done
          </Button>
        }
      >
        <p className="text-body text-ink-soft">Drag down to dismiss on a phone. Escape closes it on desktop.</p>
      </Sheet>
      <Sheet
        open={panel}
        onOpenChange={setPanel}
        title="A side panel"
        desktop="panel"
        description="For detail views on desktop."
      >
        <div className="flex flex-col gap-3">
          <Skeleton className="aspect-4/3 w-full rounded-md" />
          <RowSkeleton />
          <RowSkeleton />
        </div>
      </Sheet>
    </Section>
  );
}

/* Empty states ----------------------------------------------------------- */

function EmptySection() {
  return (
    <Section
      id="empty"
      title="Empty states"
      note="A small pasta joke in the title, plain words in the body, one next step. Illustrations: 160×120, ink outlines, one or two accents."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Panel className="py-10">
          <EmptyState illustration={<EmptyPot />} title="Nothing simmering yet">
            Ideas land here first.
          </EmptyState>
        </Panel>
        <Panel className="flex flex-wrap items-end justify-center gap-6 py-10">
          <SpoolStrand className="w-32" />
          <OpenNotebook className="w-32" />
          <NoodleSearch className="w-32" />
          <Mark className="size-16" />
        </Panel>
      </div>
    </Section>
  );
}

/* Skeletons -------------------------------------------------------------- */

function SkeletonSection() {
  return (
    <Section
      id="skeletons"
      title="Skeletons"
      note="Loading looks like the layout it will become. No full-page spinners."
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-5">
        <CardSkeleton />
        <CardSkeleton />
        <Panel className="col-span-2 py-2">
          <RowSkeleton />
          <RowSkeleton />
          <RowSkeleton />
        </Panel>
      </div>
    </Section>
  );
}
