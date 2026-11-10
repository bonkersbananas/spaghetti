import type { Item, Spool } from "@shared/api";
import { DEFAULT_PRINTER } from "@shared/spools";
import { PrintingCard } from "@/components/builds/PrintingCard";
import { NowPrintingCard } from "@/components/shell/NowPrinting";
import { BackBurner } from "@/components/today/BackBurner";
import { InThePrinter } from "@/components/today/InThePrinter";
import { PickUpAgain } from "@/components/today/PickUpAgain";
import type { ItemView } from "@/lib/items";
import { attempt, item, photo, planFile, useSamplePictures } from "./journal";
import { Label, Panel, people, SAMPLE_COLOR, Section } from "./shared";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const now = Date.now();

/** An item as the app's lists show it: numbered attempts, nothing pending. */
const view = (source: Item): ItemView => ({
  ...source,
  pending: false,
  attempts: source.attempts.map((entry, index) => ({ ...entry, file: entry.file, number: index + 1, pending: false })),
});

const withAttempts = (source: Item, attempts: Item["attempts"]): ItemView => view({ ...source, attempts });

const running = withAttempts(
  item("sample-today-running", { title: "Bath tugboat for Mila", photos: [photo("sample-tugboat-photo", null)] }),
  [
    attempt("sample-today-running-1", "sample-today-running", {
      outcome: null,
      finishedAt: null,
      finishedBy: null,
      printedAt: now - 52 * MINUTE,
      settings: {
        filaments: [{ type: "PLA", brand: "Bambu", colorHex: SAMPLE_COLOR, colorName: "Sunflower yellow" }],
        estimatedMinutes: 190,
      },
    }),
  ],
);
const due = withAttempts(item("sample-today-due", { title: "Desk cable clips" }), [
  attempt("sample-today-due-1", "sample-today-due", {
    outcome: null,
    finishedAt: null,
    finishedBy: null,
    printedAt: now - 95 * MINUTE,
    file: planFile,
    settings: {
      filaments: [{ type: "PLA", brand: "Bambu", colorHex: "#00ae42", colorName: "Bambu green" }], // design-lint-ignore: a filament color is data
      estimatedMinutes: 72,
    },
  }),
]);

const waiting = [
  withAttempts(
    item("sample-wait-1", { title: "Cable chain", photos: [photo("sample-dragon-photo", "sample-wait-1a")] }),
    [
      attempt("sample-wait-1a", "sample-wait-1", {
        outcome: "failed",
        failureTags: ["warping"],
        printedAt: now - 3 * DAY,
        finishedAt: now - 3 * DAY + HOUR,
      }),
    ],
  ),
  withAttempts(item("sample-wait-2", { title: "Hook for the desiccant bag" }), [
    attempt("sample-wait-2a", "sample-wait-2", {
      outcome: "partial",
      printedAt: now - 5 * DAY,
      finishedAt: now - 5 * DAY,
    }),
    attempt("sample-wait-2b", "sample-wait-2", {
      outcome: "success",
      printedAt: now - 2 * DAY,
      finishedAt: now - 2 * DAY,
    }),
  ]),
  withAttempts(item("sample-wait-3", { title: "Spare knob" }), []),
];

const spool = (id: string, colorName: string, colorHex: string, remaining: Spool["remaining"]): Spool =>
  ({
    id,
    material: "PLA",
    brand: "Bambu",
    colorName,
    colorHex,
    remaining,
    finish: null,
    note: "",
  }) as unknown as Spool;

const spools = [
  spool("s1", "Jade white", "#f4f1ea", "full"), // design-lint-ignore: a filament color is data
  spool("s2", "Sunflower yellow", SAMPLE_COLOR, "low"),
  spool("s3", "Black", "#1d1d1f", "empty"), // design-lint-ignore: a filament color is data
  spool("s4", "Bambu green", "#00ae42", "half"), // design-lint-ignore: a filament color is data
];

const oldIdea = view(
  item("sample-old-idea", {
    stage: "idea",
    title: null,
    note: "Replacement knob for the oven, 6 mm D-shaft. Measure the old one before it breaks completely.",
    createdAt: now - 36 * DAY,
  }),
);
const oldPhotoIdea = view(
  item("sample-old-photo", {
    stage: "idea",
    title: "Articulated dragon",
    photos: [photo("sample-dragon-photo", null)],
    createdAt: now - 80 * DAY,
  }),
);

export function TodaySection() {
  const ready = useSamplePictures();
  const [alex, sam] = people;
  return (
    <Section
      id="today"
      title="Today"
      note="The front door: what is printing, where to pick up again, what is loaded and one old idea to look at again. Each block is drawn only when it has something to say, and the only card title in Fraunces is the print on the bed."
    >
      {ready && (
        <div className="grid gap-8 lg:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-4">
            <Label>
              PrintingCard: on the bed, and once it should be done (compact on phones: every print after the first)
            </Label>
            <PrintingCard item={running} attempt={running.attempts[0] as ItemView["attempts"][number]} person={alex} />
            <PrintingCard item={due} attempt={due.attempts[0] as ItemView["attempts"][number]} person={sam} compact />
            <Label>The sidebar's now-printing card</Label>
            <div className="w-60">
              <NowPrintingCard item={running} attempt={running.attempts[0] as ItemView["attempts"][number]} />
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-8">
            <Panel className="flex flex-col gap-8">
              <PickUpAgain builds={waiting} />
              <InThePrinter
                setup={DEFAULT_PRINTER}
                slots={{ A1: "s1", A2: "s2", A3: "s3", Ext: "s4" }}
                spools={spools}
              />
            </Panel>
            <Label>On the back burner: a note, and a photo</Label>
            <Panel className="flex flex-col gap-8">
              <BackBurner idea={oldIdea} person={alex} />
              <BackBurner idea={oldPhotoIdea} person={sam} />
            </Panel>
          </div>
        </div>
      )}
    </Section>
  );
}
