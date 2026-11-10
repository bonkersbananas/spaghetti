import type { Person, Spool } from "@shared/api";
import type { Outcome } from "@shared/attempts";
import { searchTerms } from "@shared/search";
import { createFileRoute } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import dragonPhoto from "@/assets/samples/dragon.svg";
import planterPhoto from "@/assets/samples/planter.svg";
import vasePhoto from "@/assets/samples/vase.svg";
import { AttemptEntry } from "@/components/builds/AttemptEntry";
import { EstimateLine } from "@/components/builds/Estimate";
import { OutcomeChip, OutcomePicker } from "@/components/builds/Outcome";
import { FileCard, PlateThumb } from "@/components/builds/SlicerFile";
import { TagPicker } from "@/components/builds/TagPicker";
import { EmptyPot, Mark, NoodleSearch, OpenNotebook, PantryJar, SpoolStrand } from "@/components/illustrations";
import { AmsLoadout } from "@/components/pantry/Ams";
import { SpoolCard } from "@/components/pantry/SpoolCard";
import { OfflineBanner } from "@/components/shell/OfflineNotice";
import { PageHeader } from "@/components/shell/PageHeader";
import { ThemeSwitch } from "@/components/shell/ThemeSwitch";
import { Avatar, AvatarStack } from "@/components/ui/Avatar";
import { Button, IconButton } from "@/components/ui/Button";
import { Card, PhotoCountBadge } from "@/components/ui/Card";
import { Caution, FromFileMark } from "@/components/ui/Caution";
import { Chip, ToggleChip } from "@/components/ui/Chip";
import { Disclosure } from "@/components/ui/Disclosure";
import { EmptyState } from "@/components/ui/EmptyState";
import { DurationField, NumberField, TextArea, TextField } from "@/components/ui/Field";
import { ChipDivider, ChipRow, FilterGroup } from "@/components/ui/FilterChips";
import { Highlight } from "@/components/ui/Highlight";
import * as Icons from "@/components/ui/icons";
import { Kbd } from "@/components/ui/Kbd";
import { MetaList } from "@/components/ui/MetaList";
import { NoteField } from "@/components/ui/NoteField";
import { Overline } from "@/components/ui/Overline";
import { type PaletteGroup, PaletteSurface } from "@/components/ui/Palette";
import { Photo } from "@/components/ui/Photo";
import { AddPhotoTile, PhotoThumb } from "@/components/ui/PhotoTiles";
import { RemainingMeter } from "@/components/ui/RemainingMeter";
import { type SaveState, SaveStatus } from "@/components/ui/SaveStatus";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Sheet } from "@/components/ui/Sheet";
import { ShortcutList } from "@/components/ui/ShortcutList";
import { CardSkeleton, RowSkeleton, Skeleton } from "@/components/ui/Skeleton";
import { SpoolDisc } from "@/components/ui/SpoolDisc";
import { Swatch, SwatchPicker } from "@/components/ui/Swatch";
import { toast } from "@/components/ui/Toast";
import { ProgressRing, UploadBadge } from "@/components/ui/UploadBadge";
import { cn } from "@/lib/cn";
import type { AttemptView } from "@/lib/items";

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
  ["controls", "Controls"],
  ["chips", "Chips"],
  ["avatars", "Avatars"],
  ["cards", "Cards"],
  ["photos", "Photos"],
  ["builds", "Builds & attempts"],
  ["pantry", "Pantry & printer"],
  ["search", "Journal & search"],
  ["sheets", "Sheets & toasts"],
  ["palette", "Palette & shortcuts"],
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
          <ControlSection />
          <ChipSection />
          <AvatarSection />
          <CardSection />
          <PhotoSection />
          <BuildsSection />
          <PantrySection />
          <SearchSection />
          <PaletteSection />
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
        <Panel className="flex min-w-0 flex-col gap-4">
          <Label>Offline notice</Label>
          <OfflineBanner waiting={0} />
          <OfflineBanner waiting={2} />
          <OfflineBanner waiting={0} seenAt={Date.now() - 2 * 60 * 60 * 1000} />
          <p className="text-small text-ink-faint">
            The one quiet place that says there is no connection. Captures wait in the outbox on this device. Over data
            kept from an earlier visit it also says how old that is (the last row); saved things are read-only until the
            connection is back.
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
        <div className="flex flex-col gap-1 md:flex-row md:items-baseline md:gap-6">
          <span className="text-caption text-ink-faint w-24 shrink-0 font-semibold">Overline</span>
          <Overline count={3}>Attempts</Overline>
        </div>
        <div className="flex flex-col gap-1 md:flex-row md:items-baseline md:gap-6">
          <span className="text-caption text-ink-faint w-24 shrink-0 font-semibold">SectionHeading</span>
          <div className="flex flex-col gap-2">
            <SectionHeading count={3}>Attempts</SectionHeading>
            <SectionHeading size="title" count={8}>
              PLA
            </SectionHeading>
          </div>
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
      <Panel className="flex min-w-0 flex-col gap-4">
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

/* Controls --------------------------------------------------------------- */

function ControlSection() {
  const [nozzle, setNozzle] = useState<"main" | "auxiliary">("main");
  const [bed, setBed] = useState<number | undefined>(60);
  const [layer, setLayer] = useState<number | undefined>(0.2);
  const [minutes, setMinutes] = useState<number | undefined>(130);
  const [color, setColor] = useState<string | undefined>(SAMPLE_COLOR);
  const [open, setOpen] = useState(false);
  return (
    <Section
      id="controls"
      title="Controls"
      note="For print settings: choices side by side, numbers with their units, a filament's color, and detail tucked behind one tap."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Panel className="flex flex-col gap-5">
          <Label>Segmented control (arrow keys move)</Label>
          <SegmentedControl
            label="Nozzle"
            options={[
              { value: "main", label: "Main" },
              { value: "auxiliary", label: "Auxiliary" },
            ]}
            value={nozzle}
            onChange={setNozzle}
            className="w-full"
          />
          <Label>Number, decimal and duration fields</Label>
          <div className="grid grid-cols-3 gap-2.5">
            <NumberField size="sm" label="Bed" suffix="°C" min={0} max={150} value={bed} onChange={setBed} />
            <NumberField size="sm" label="Layer" suffix="mm" decimal value={layer} onChange={setLayer} />
            <DurationField size="sm" label="Time" placeholder="2h 10" value={minutes} onChange={setMinutes} />
          </div>
          <Label>Filament color: a swatch, and a picker to tap</Label>
          <div className="flex items-center gap-3">
            <SwatchPicker value={color} onChange={setColor} />
            <SwatchPicker value={undefined} onChange={setColor} label="No color yet" />
            <span className="text-small text-ink-soft inline-flex items-center gap-1.5">
              <Swatch color={color} /> Jade white PLA
            </span>
          </div>
        </Panel>
        <Panel className="flex flex-col gap-5">
          <Label>Disclosure</Label>
          <Disclosure
            open={open}
            onOpenChange={setOpen}
            title="Settings"
            icon={Icons.SettingsIcon}
            summary="Same as attempt 2 · PLA · 0.20 mm · bed 60 °C"
          >
            <p className="text-body text-ink-soft">The optional detail lives here, out of the way of the quick path.</p>
          </Disclosure>
          <Label>Action bar (phones)</Label>
          <p className="text-body text-ink-soft">
            <code className="text-small">ActionBar</code> puts a screen's main action within thumb reach, on top of the
            tab bar, such as "Log attempt" on a build. Hidden on desktop, where the action sits in the page; toasts move
            up above it.
          </p>
          <div className="bg-paper-deep rounded-md p-3">
            <Button variant="primary" size="lg" icon={Icons.PlusIcon} fullWidth>
              Log attempt
            </Button>
          </div>
        </Panel>
      </div>
    </Section>
  );
}

/* Chips ------------------------------------------------------------------ */

function ChipSection() {
  const [selected, setSelected] = useState("PLA");
  const [tags, setTags] = useState(["warping"]);
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
        <Label>Toned toggle chips, for tags</Label>
        <div className="flex flex-wrap gap-2">
          {["warping", "stringing"].map((tag) => (
            <ToggleChip
              key={tag}
              tone="tomato"
              selected={tags.includes(tag)}
              onClick={() => setTags(tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag])}
            >
              {tag === "warping" ? "Warping" : "Stringing"}
            </ToggleChip>
          ))}
          <ToggleChip tone="basil" selected>
            Great first layer
          </ToggleChip>
          <ToggleChip tone="semolina" selected icon={Icons.DriedIcon}>
            Dried
          </ToggleChip>
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
      <div className="mt-10">
        <Label>Note cards: the shorter the note, the larger it is set (NoteFace, by length)</Label>
        <div className="grid grid-cols-2 items-start gap-3 md:grid-cols-4 md:gap-5">
          <Card note="Hook for the bike helmet" meta="xl · up to 32 letters" aspect="portrait" />
          <Card
            note="Bag clips for the coffee, with a little spoon holder on the side."
            meta="lg · up to 72"
            aspect="portrait"
          />
          <Card
            note="Replacement knob for the oven, 6 mm D-shaft. Measure the old one before it breaks completely."
            meta="md · up to 130"
            aspect="portrait"
          />
          <Card
            note={
              "Drawer bins on a 42 mm grid for the screws, the spare nozzles and the hex keys. Two heights, so the tall drivers stand up.\n\nLabels in a second color, swapped at the layer they start on."
            }
            meta="sm · longer, fades at the end"
            aspect="portrait"
          />
        </div>
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
        <Panel className="flex min-w-0 flex-col gap-4">
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
        <Panel className="flex min-w-0 flex-col gap-4">
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

/* Builds & attempts ------------------------------------------------------ */

const SAMPLE_COLOR = "#f2c230"; // design-lint-ignore: a filament color is data

const sampleAttempt: AttemptView = {
  id: "sample-attempt",
  itemId: "sample-build",
  number: 2,
  pending: false,
  outcome: "partial",
  printedAt: Date.now() - 26 * 60 * 60 * 1000,
  finishedAt: Date.now() - 23 * 60 * 60 * 1000,
  note: "Stayed down this time, but the stern corners curled up a little.",
  failureTags: ["warping"],
  successNotes: ["great-first-layer"],
  file: null,
  settings: {
    filaments: [{ type: "PLA", brand: "Bambu", colorHex: SAMPLE_COLOR, colorName: "Sunflower yellow", amsSlot: "A2" }],
    bedType: "Textured PEI Plate",
    layerHeight: 0.2,
    infillDensity: 15,
    brim: true,
    nozzleTemperature: 220,
    bedTemperature: 60,
    estimatedMinutes: 190,
    actualMinutes: 197,
  },
  changes: [
    { key: "bedType", text: "Smooth PEI → Textured PEI plate" },
    { key: "brim", text: "added a brim" },
    { key: "bedTemperature", text: "bed 55 → 60 °C" },
  ],
  createdBy: "a",
  createdVia: null,
  finishedBy: "a",
  finishedVia: null,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

/* Journal & search ------------------------------------------------------- */

function SearchSection() {
  const [outcome, setOutcome] = useState<string | null>("failures");
  const terms = searchTerms("petg warp");
  return (
    <Section
      id="search"
      title="Journal & search"
      note="Chip rows for filters and suggestions, a filter column on desktop, and matched words highlighted."
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel className="flex min-w-0 flex-col gap-4">
          <Label>ChipRow: scrolls sideways on phones, wraps on desktop</Label>
          <ChipRow label="Filters">
            {[
              ["failures", "Only failures", Icons.LessonsIcon, "tomato"],
              ["success", "Worked", Icons.WorkedIcon, "basil"],
            ].map(([value, label, icon, tone]) => (
              <ToggleChip
                key={value as string}
                selected={outcome === value}
                icon={icon as Icons.Icon}
                tone={tone as "tomato" | "basil"}
                onClick={() => setOutcome(outcome === value ? null : (value as string))}
              >
                {label as string}
              </ToggleChip>
            ))}
            <ChipDivider />
            <ToggleChip selected={false}>PETG</ToggleChip>
            <ToggleChip selected={false}>PLA</ToggleChip>
          </ChipRow>
          <Label>FilterGroup, in the desktop filter column</Label>
          <FilterGroup label="Who">
            {people.map((person) => (
              <ToggleChip key={person.id} selected={person.id === "b"} className="pl-1.5">
                <Avatar person={person} size="xs" />
                {person.name.split(" ")[0]}
              </ToggleChip>
            ))}
          </FilterGroup>
        </Panel>
        <Panel className="flex min-w-0 flex-col gap-4">
          <Label>Highlight: the words a search matched (“petg warp”)</Label>
          <p className="text-body text-ink-soft">
            <Highlight text="Corners warped off the cool plate. PETG wants the textured sheet." terms={terms} />
          </p>
          <Label>MetaList: a dot never begins or ends a line (narrow it to see)</Label>
          <div className="bg-ink/4 w-56 rounded-sm p-2">
            <MetaList className="text-small text-ink-faint">
              <span>Black PETG</span>
              <span>0.20 mm</span>
              <span>15% infill</span>
              <span>Cool Plate</span>
              <span className="whitespace-nowrap">nozzle 245 °C</span>
            </MetaList>
          </div>
          <Label>A month heading in the journal</Label>
          <div className="flex flex-col gap-1">
            <Overline as="h3">October</Overline>
            <span className="font-display text-title text-ink-soft">5 prints, 1 spaghetti, phone stand finished</span>
          </div>
        </Panel>
      </div>
    </Section>
  );
}

const paletteHints = [
  { keys: ["↑", "↓"], label: "Move" },
  { keys: ["↵"], label: "Open" },
  { keys: ["Esc"], label: "Close" },
];

const paletteEmpty = {
  title: "Nothing in the pot",
  text: "No idea, build, attempt or action goes by that name. Try fewer words.",
};

function PaletteSection() {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<string | undefined>("a");
  const terms = searchTerms("tug");
  const groups: PaletteGroup[] = [
    {
      id: "this",
      label: "This build",
      rows: [
        { id: "a", label: "Log attempt", title: "Log attempt", icon: Icons.PlusIcon, keys: ["A"] },
        { id: "b", label: "Finish build", title: "Finish build", icon: Icons.FinishIcon },
      ],
    },
    {
      id: "builds",
      label: "Builds",
      rows: [
        {
          id: "c",
          label: "Tugboat",
          title: <Highlight text="Tugboat, take two" terms={terms} />,
          subtitle: "On the bed · 3 attempts",
          photo: { src: vasePhoto, color: "#c9b8a4" }, // design-lint-ignore
          trailing: <OutcomeChip outcome="partial" />,
        },
        {
          id: "d",
          label: "Vase",
          title: "Spiral vase",
          subtitle: "Done · 2 attempts",
          photo: { src: planterPhoto, color: "#b9c4a8" }, // design-lint-ignore
          trailing: <OutcomeChip outcome="success" />,
        },
      ],
    },
  ];
  return (
    <Section
      id="palette"
      title="Palette & shortcuts"
      note="Command palette (⌘K, desktop only): jump to anything or run an action; what fits the screen comes first. The shortcut list (?) reads the same registry the keys use, so the two can't drift."
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-3">
          <Label>PaletteSurface, with results</Label>
          <div className="bg-lifted shadow-float overflow-hidden rounded-xl">
            <PaletteSurface
              query={query}
              onQueryChange={setQuery}
              groups={groups}
              activeId={active}
              onActiveChange={setActive}
              onRun={setActive}
              empty={paletteEmpty}
              hints={paletteHints}
            />
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <Label>While results are on their way (the old ones dim)</Label>
          <div className="bg-lifted shadow-float overflow-hidden rounded-xl">
            <PaletteSurface
              query="tugb"
              onQueryChange={() => undefined}
              groups={groups.slice(0, 1)}
              activeId="a"
              onActiveChange={() => undefined}
              onRun={() => undefined}
              pending
              stale
              empty={paletteEmpty}
            />
          </div>
          <Label>Nothing matches</Label>
          <div className="bg-lifted shadow-float overflow-hidden rounded-xl">
            <PaletteSurface
              query="zzz"
              onQueryChange={() => undefined}
              groups={[]}
              activeId={undefined}
              onActiveChange={() => undefined}
              onRun={() => undefined}
              empty={paletteEmpty}
            />
          </div>
        </div>
      </div>
      <Panel className="mt-6">
        <Label>ShortcutList: everything the keyboard does, by screen</Label>
        <ShortcutList />
      </Panel>
    </Section>
  );
}

function BuildsSection() {
  const [outcome, setOutcome] = useState<Outcome | null>("failed");
  const [failureTags, setFailureTags] = useState(["spaghetti"]);
  return (
    <Section
      id="builds"
      title="Builds & attempts"
      note="Logging an attempt next to the printer: the outcome is one big tap, tags and settings one more. A failed print is spaghetti, recorded with the same care as a success: soft tomato, never an error."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Panel className="flex flex-col gap-5">
          <Label>Outcome picker</Label>
          <OutcomePicker value={outcome} onChange={setOutcome} />
          <Label>Outcome chips</Label>
          <div className="flex flex-wrap gap-2">
            <OutcomeChip outcome={null} />
            <OutcomeChip outcome="success" />
            <OutcomeChip outcome="partial" />
            <OutcomeChip outcome="failed" />
          </div>
          <TagPicker
            kind="failure"
            label="Tag picker: what went wrong?"
            value={failureTags}
            onChange={setFailureTags}
            visible={6}
          />
        </Panel>
        <div className="flex flex-col gap-4">
          <Label>Attempt in a build's timeline</Label>
          <ol className="flex flex-col">
            <AttemptEntry
              attempt={sampleAttempt}
              photos={[]}
              person={people[1]}
              first
              last
              onOpen={() => toast.message("Opens the attempt")}
            />
          </ol>
          <Label>New build tiles</Label>
          <div className="grid grid-cols-2 gap-3">
            <AddPhotoTile size="card" icon={Icons.PlusIcon} label="New build" />
            <div className="flex flex-col justify-end">
              <AddPhotoTile size="row" icon={Icons.PlusIcon} label="New build" />
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}

/* Pantry & printer ------------------------------------------------------- */

const SILK = "#c9a46b"; // design-lint-ignore: a filament color is data
const TEAL = "#2c8a87"; // design-lint-ignore: a filament color is data

const sampleSpool: Spool = {
  id: "sample-spool",
  material: "PLA",
  brand: "Eryone",
  colorName: "Silk gold",
  colorHex: SILK,
  finish: "silk",
  remaining: "half",
  note: "",
  driedAt: null,
  photo: null,
  slot: "A2",
  createdBy: "a",
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

function PantrySection() {
  const [nozzle, setNozzle] = useState<number | undefined>(310);
  return (
    <Section
      id="pantry"
      title="Pantry & printer"
      note="Spools are drawn as spools, in their own color (data, set inline), with a rough meter of what's left. Printer checks are a gentle semolina line, never a dialog; values from a slicer file carry a small file mark until someone changes them."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Panel className="flex flex-col gap-5">
          <Label>Spool discs: sm, md, lg, xl, and an empty slot</Label>
          <div className="flex flex-wrap items-end gap-4">
            <SpoolDisc color={SILK} size="sm" />
            <SpoolDisc color={TEAL} size="md" />
            <SpoolDisc color={SAMPLE_COLOR} size="lg" />
            <SpoolDisc color={SILK} size="xl" />
            <SpoolDisc empty size="lg" />
          </div>
          <Label>What's left</Label>
          <div className="flex flex-wrap gap-4">
            <RemainingMeter remaining="full" showLabel />
            <RemainingMeter remaining="half" showLabel />
            <RemainingMeter remaining="low" showLabel />
            <RemainingMeter remaining="empty" showLabel />
          </div>
          <Label>A printer check, and a value from a slicer file</Label>
          <NumberField
            size="sm"
            label="Nozzle"
            mark={<FromFileMark />}
            suffix="°C"
            value={nozzle}
            onChange={setNozzle}
            caution={nozzle !== undefined && nozzle > 300 ? "The X2D's nozzles top out at 300 °C." : undefined}
            className="max-w-48"
          />
          <Caution>TPU doesn't feed well through the AMS: the external spool is safer.</Caution>
        </Panel>
        <div className="flex flex-col gap-4">
          <Label>A spool in the pantry</Label>
          <ul className="grid grid-cols-2 gap-3">
            <SpoolCard spool={sampleSpool} draggable={false} />
            <SpoolCard
              spool={{
                ...sampleSpool,
                id: "sample-2",
                colorName: "Teal",
                colorHex: TEAL,
                material: "PETG",
                brand: "Polymaker",
                finish: null,
                remaining: "low",
                slot: null,
              }}
              draggable={false}
            />
          </ul>
          <Label>A slicer file on an attempt, and how long it took</Label>
          <FileCard name="desk-clips.gcode.3mf" meta={["plate 1 of 2", "est. 1 h 12 min", "14 KB"]} download="#" />
          <EstimateLine estimated={72} actual={78} />
          <div className="flex gap-2">
            <PlateThumb alt="" className="size-16" />
          </div>
        </div>
      </div>
      <Label>The AMS as it is loaded here (live; the pantry changes it)</Label>
      <AmsLoadout readOnly className="md:max-w-3xl" />
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
          <PantryJar className="w-32" />
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
