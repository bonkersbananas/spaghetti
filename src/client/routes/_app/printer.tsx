import { BED_TYPES, NOZZLE_DIAMETERS, type Nozzle, plateName } from "@shared/attempts";
import { DRYING_DAYS } from "@shared/drying";
import { type NozzleSetup, type PrinterSetup, X2D } from "@shared/spools";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { lazy, type ReactNode, Suspense, useMemo, useState } from "react";
import { AmsLoadout } from "@/components/pantry/Ams";
import { PrinterBridgeLine } from "@/components/pantry/BridgeLine";
import { PageHeader } from "@/components/shell/PageHeader";
import { IconButton } from "@/components/ui/Button";
import { ToggleChip } from "@/components/ui/Chip";
import { Disclosure } from "@/components/ui/Disclosure";
import {
  HardenedIcon,
  InfoIcon,
  MinusIcon,
  PantryIcon,
  PlusIcon,
  RulerIcon,
  TemperatureIcon,
} from "@/components/ui/icons";
import { SaveStatus } from "@/components/ui/SaveStatus";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Skeleton } from "@/components/ui/Skeleton";
import { loadSlot, printerQuery, savePrinterSetup } from "@/lib/pantry";
import { useReadOnly } from "@/lib/read-only";
import { useLiveFields } from "@/lib/use-autosave";
import { useIdle } from "@/lib/use-idle";

const Upkeep = lazy(() => import("@/components/printer/Upkeep").then((m) => ({ default: m.Upkeep })));
// Below the fold, or only after a tap: their own chunks, not part of the first load.
const DryingTable = lazy(() => import("@/components/printer/DryingTable").then((m) => ({ default: m.DryingTable })));
const AddSpoolSheet = lazy(() =>
  import("@/components/pantry/AddSpoolSheet").then((m) => ({ default: m.AddSpoolSheet })),
);

export const Route = createFileRoute("/_app/printer")({
  component: Printer,
});

function Printer() {
  const { data, isPending } = useQuery(printerQuery);
  return (
    <>
      <PageHeader
        title="Printer"
        subtitle="The X2D as it's set up here. Spaghetti never controls it; this is what you've told it."
      />
      {isPending || !data ? (
        <div className="flex flex-col gap-6" aria-hidden>
          <Skeleton className="h-36 w-full rounded-xl md:max-w-3xl" />
          <Skeleton className="h-52 w-full rounded-xl md:max-w-3xl" />
        </div>
      ) : (
        <Setup key="setup" initial={data.setup} />
      )}
    </>
  );
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  const id = `printer-${title.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={id} className="text-title text-ink">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Fact({ icon: Icon, label, value }: { icon: typeof RulerIcon; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="bg-ink/5 text-ink-soft flex size-9 shrink-0 items-center justify-center rounded-md">
        <Icon size={20} aria-hidden />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-small text-ink-faint">{label}</span>
        <span className="text-body text-ink tabular font-semibold">{value}</span>
      </span>
    </div>
  );
}

const NOZZLE_NAMES: Record<Nozzle, { title: string; detail: string }> = {
  main: { title: "Main nozzle", detail: "Direct drive, on the left. Takes TPU." },
  auxiliary: { title: "Auxiliary nozzle", detail: "Fed through a Bowden tube. Best for supports." },
};

/** The setup as the form's fields: each can be edited (and saved) on its own. */
interface SetupFields extends Record<string, unknown> {
  main: NozzleSetup;
  auxiliary: NozzleSetup;
  plates: string[];
  amsUnits: number;
  dryingDays: Record<string, number>;
}

function Setup({ initial }: { initial: PrinterSetup }) {
  const queryClient = useQueryClient();
  // Each part follows the server's copy (the other person's edit) except the one being edited here, and a
  // save sends only the parts changed here.
  const server = useMemo<SetupFields>(
    () => ({
      main: initial.nozzles.main,
      auxiliary: initial.nozzles.auxiliary,
      plates: initial.plates,
      amsUnits: initial.amsUnits,
      dryingDays: initial.dryingDays ?? {},
    }),
    [initial],
  );
  const { value, change, saveState } = useLiveFields<SetupFields>(server, ({ main, auxiliary, ...rest }) =>
    savePrinterSetup(queryClient, {
      ...rest,
      ...(main || auxiliary ? { nozzles: { ...(main && { main }), ...(auxiliary && { auxiliary }) } } : {}),
    }),
  );
  const setup: PrinterSetup = {
    nozzles: { main: value.main, auxiliary: value.auxiliary },
    plates: value.plates,
    amsUnits: value.amsUnits,
    dryingDays: value.dryingDays,
  };
  const [adding, setAdding] = useState<string | null>(null);
  const idle = useIdle();
  const [dryingOpen, setDryingOpen] = useState(false);
  // The add-a-spool sheet's code loads with the first tap and stays mounted after, so it can slide away.
  const [sheetLoaded, setSheetLoaded] = useState(false);
  if (adding !== null && !sheetLoaded) setSheetLoaded(true);
  // Offline, the setup is only for reading (see lib/read-only.ts).
  const readOnly = useReadOnly();

  const setNozzle = (nozzle: Nozzle, patch: Partial<NozzleSetup>) =>
    change((current) => ({ [nozzle]: { ...current[nozzle], ...patch } }));
  const togglePlate = (plate: string) =>
    change((current) => ({
      plates: current.plates.includes(plate) ? current.plates.filter((p) => p !== plate) : [...current.plates, plate],
    }));
  const units = setup.amsUnits;

  return (
    <div className="flex max-w-3xl flex-col gap-12">
      <div className="bg-cream shadow-soft flex flex-col gap-5 rounded-xl p-5 md:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col">
            <span className="font-display text-headline text-ink font-semibold">{X2D.name}</span>
            <span className="text-small text-ink-faint">
              Combo · {units === 0 ? "no AMS" : `${units} AMS 2 Pro`} · two nozzles
            </span>
          </div>
          <SaveStatus state={saveState} />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Fact
            icon={RulerIcon}
            label="Build volume"
            value={`${X2D.buildVolume.x} × ${X2D.buildVolume.y} × ${X2D.buildVolume.z} mm`}
          />
          <Fact
            icon={RulerIcon}
            label="With both nozzles"
            value={`about ${X2D.dualBuildVolume.x} × ${X2D.dualBuildVolume.y} × ${X2D.dualBuildVolume.z} mm`}
          />
          <Fact
            icon={TemperatureIcon}
            label="Nozzle and bed, at most"
            value={`${X2D.maxNozzleTemperature} °C · ${X2D.maxBedTemperature} °C`}
          />
          <Fact icon={TemperatureIcon} label="Heated chamber" value={`up to ${X2D.maxChamberTemperature} °C`} />
        </div>
        <PrinterBridgeLine />
      </div>

      {idle ? (
        <Suspense fallback={<Skeleton className="h-52 w-full rounded-xl" aria-hidden />}>
          <Upkeep />
        </Suspense>
      ) : (
        <Skeleton className="h-52 w-full rounded-xl" aria-hidden />
      )}

      <fieldset disabled={readOnly} className="contents">
        <Section title="Nozzles">
          <div className="grid gap-3 md:grid-cols-2">
            {(["main", "auxiliary"] as const).map((nozzle) => {
              const fitted = setup.nozzles[nozzle];
              return (
                <section
                  key={nozzle}
                  className="bg-cream shadow-soft flex flex-col gap-4 rounded-lg p-4"
                  aria-label={NOZZLE_NAMES[nozzle].title}
                >
                  <div className="flex flex-col">
                    <span className="text-body text-ink font-semibold">{NOZZLE_NAMES[nozzle].title}</span>
                    <span className="text-small text-ink-faint">{NOZZLE_NAMES[nozzle].detail}</span>
                  </div>
                  {/* Four sizes side by side: never a lone 0.8 mm wrapped onto its own line. */}
                  <SegmentedControl
                    label={`${NOZZLE_NAMES[nozzle].title} size`}
                    labelHidden
                    options={NOZZLE_DIAMETERS.map((diameter) => ({ value: String(diameter), label: `${diameter} mm` }))}
                    value={String(fitted.diameter)}
                    onChange={(diameter) => setNozzle(nozzle, { diameter: Number(diameter) })}
                    className="w-full"
                  />
                  <ToggleChip
                    tone="basil"
                    icon={HardenedIcon}
                    selected={fitted.hardened}
                    onClick={() => setNozzle(nozzle, { hardened: !fitted.hardened })}
                    className="self-start"
                  >
                    {fitted.hardened ? "Hardened steel" : "Not hardened"}
                  </ToggleChip>
                </section>
              );
            })}
          </div>
        </Section>

        <Section title="Plates you own">
          {/* biome-ignore lint/a11y/useSemanticElements: a row of chips, not a form field set. */}
          <div className="flex flex-wrap gap-2" role="group" aria-label="Plates you own">
            {[...BED_TYPES, ...setup.plates.filter((plate) => !(BED_TYPES as readonly string[]).includes(plate))].map(
              (plate) => (
                <ToggleChip key={plate} selected={setup.plates.includes(plate)} onClick={() => togglePlate(plate)}>
                  {plateName(plate)}
                </ToggleChip>
              ),
            )}
          </div>
        </Section>

        <Section
          title="AMS"
          aside={
            <Link
              to="/pantry"
              className="focus-ring text-small text-ink-soft hover:text-ink inline-flex items-center gap-1.5 rounded-sm font-semibold"
            >
              <PantryIcon size={16} aria-hidden />
              Pantry
            </Link>
          }
        >
          <AmsLoadout readOnly={readOnly} onAddSpool={setAdding} />
          <div className="flex items-center gap-3">
            <span className="text-small text-ink-soft flex-1">
              {units === 1 ? "One AMS unit" : units === 0 ? "No AMS units" : `${units} AMS units`}, up to{" "}
              {X2D.maxAmsUnits}.
            </span>
            <IconButton
              icon={MinusIcon}
              variant="secondary"
              size="sm"
              label="One AMS unit fewer"
              disabled={units <= 0}
              onClick={() => change((current) => ({ amsUnits: Math.max(0, current.amsUnits - 1) }))}
            />
            <IconButton
              icon={PlusIcon}
              variant="secondary"
              size="sm"
              label="One AMS unit more"
              disabled={units >= X2D.maxAmsUnits}
              onClick={() => change((current) => ({ amsUnits: Math.min(X2D.maxAmsUnits, current.amsUnits + 1) }))}
            />
          </div>
        </Section>

        <Section title="Staying dry">
          <Disclosure
            open={dryingOpen}
            onOpenChange={setDryingOpen}
            title="Days each material stays dry"
            summary="Past that, Spaghetti says to dry it before printing. Starting values are a guide, not Bambu's word."
          >
            {dryingOpen && (
              <Suspense fallback={null}>
                <DryingTable
                  days={{ ...DRYING_DAYS, ...value.dryingDays }}
                  onChange={(dryingDays) => change({ dryingDays })}
                />
              </Suspense>
            )}
          </Disclosure>
        </Section>
      </fieldset>
      <p className="text-small text-ink-faint flex items-start gap-2">
        <InfoIcon size={16} className="mt-0.5 shrink-0" aria-hidden />
        These are the checks behind the gentle hints while logging an attempt: temperatures past the X2D's limits, TPU
        on the auxiliary nozzle or through the AMS, and abrasive filament on a nozzle that isn't hardened.
      </p>
      {sheetLoaded && (
        <Suspense fallback={null}>
          <AddSpoolSheet
            open={adding !== null}
            onOpenChange={(open) => !open && setAdding(null)}
            description={
              adding
                ? `It goes straight into ${adding === "Ext" ? "the external holder" : `slot ${adding}`}.`
                : undefined
            }
            onAdded={(spool, saved) => {
              if (adding) void loadSlot(queryClient, adding, spool.id, saved);
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
