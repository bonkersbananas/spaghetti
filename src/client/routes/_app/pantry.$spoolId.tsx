import type { Spool } from "@shared/api";
import { OUTCOME_LABELS, OUTCOMES } from "@shared/attempts";
import type { LabelField } from "@shared/label-read";
import { gramsText } from "@shared/ledger";
import { recipesFor } from "@shared/recipes";
import {
  FINISHES,
  finishLabel,
  REMAINING,
  REMAINING_LABELS,
  type Remaining,
  SPOOL_MATERIALS,
  slotPlace,
  spoolName,
} from "@shared/spools";
import { inlineTime } from "@shared/time";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { EmptyPot, SpoolStrand } from "@/components/illustrations";
import { AmsLoadout } from "@/components/pantry/Ams";
import { DryIt } from "@/components/pantry/DryIt";
import { LabelFacts } from "@/components/pantry/LabelFacts";
import { LabelReadNote } from "@/components/pantry/LabelReadNote";
import { GramsHero, UsedBy } from "@/components/pantry/SpoolGrams";
import { SetWeightSheet, WeighSheet } from "@/components/pantry/WeightSheets";
import { LazyRecipeShelf } from "@/components/recipes/LazyRecipeSheet";
import { AttemptResult } from "@/components/search/Results";
import { DetailBar } from "@/components/shell/DetailBar";
import { Button, IconButton } from "@/components/ui/Button";
import { collapseChips, MoreChip, ToggleChip } from "@/components/ui/Chip";
import { Disclosure } from "@/components/ui/Disclosure";
import { EmptyState } from "@/components/ui/EmptyState";
import { TextArea, TextField } from "@/components/ui/Field";
import { FromLabel } from "@/components/ui/FromLabel";
import { CameraIcon, DriedIcon, ImageIcon, SettingsIcon, SparkleIcon, TrashIcon } from "@/components/ui/icons";
import { MetaList } from "@/components/ui/MetaList";
import { NoteField } from "@/components/ui/NoteField";
import { Photo } from "@/components/ui/Photo";
import { useFilePicker } from "@/components/ui/PhotoTiles";
import { SaveStatus } from "@/components/ui/SaveStatus";
import { Section } from "@/components/ui/Section";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Sheet } from "@/components/ui/Sheet";
import { RowSkeleton, Skeleton } from "@/components/ui/Skeleton";
import { SpoolDisc } from "@/components/ui/SpoolDisc";
import { SwatchPicker } from "@/components/ui/Swatch";
import { useHotkeys } from "@/lib/hotkeys";
import { pollWhileReading, requestLabelRead, useLabelReadsEnabled } from "@/lib/label-read";
import { deleteSpool, loadSlot, saveSpool, setSpoolPhoto } from "@/lib/pantry";
import { spoolAttemptsQuery, spoolsQuery } from "@/lib/pantry-queries";
import { photoSrc } from "@/lib/previews";
import { canEdit, useReadOnly } from "@/lib/read-only";
import { useRecipes } from "@/lib/recipes";
import { useStickyColumn } from "@/lib/sticky-column";
import { useLiveFields } from "@/lib/use-autosave";
import { useIsDesktop } from "@/lib/use-media-query";

export const Route = createFileRoute("/_app/pantry/$spoolId")({
  component: SpoolDetail,
});

const back = { to: "/pantry", label: "Pantry" } as const;

function SpoolDetail() {
  const { spoolId } = Route.useParams();
  const { data: spools, isPending, error } = useQuery(spoolsQuery);
  const spool = spools?.find((s) => s.id === spoolId);
  if (spool) return <SpoolPage key={spool.id} spool={spool} />;
  return (
    <>
      <h1 className="sr-only">Spool</h1>
      <DetailBar back={back} />
      {isPending ? (
        <div className="flex flex-col gap-6 md:flex-row md:gap-10" aria-hidden>
          <Skeleton className="aspect-square w-full rounded-xl md:flex-2" />
          <div className="flex flex-col gap-3 md:flex-3">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-28 w-full rounded-lg" />
          </div>
        </div>
      ) : (
        <EmptyState
          className="py-10 md:py-20"
          illustration={<EmptyPot />}
          title={error ? "This one is out of reach" : "Used up, or never here"}
          action={
            <Link to="/pantry" className="focus-ring rounded-md">
              <Button variant="secondary" tabIndex={-1}>
                Back to the pantry
              </Button>
            </Link>
          }
        >
          {error
            ? "It can't load without a connection. It will be here when you're back."
            : "This spool was taken out of the pantry, or it never made it here."}
        </EmptyState>
      )}
    </>
  );
}

type Editable = Pick<
  Spool,
  | "material"
  | "brand"
  | "colorName"
  | "colorHex"
  | "finish"
  | "remaining"
  | "note"
  | "driedAt"
  | "diameterMm"
  | "nozzleTempMin"
  | "nozzleTempMax"
  | "bedTempMin"
  | "bedTempMax"
  | "dryTempC"
  | "dryHours"
  | "productCode"
>;

const same = (a: unknown, b: unknown) => a === b;

function SpoolPage({ spool }: { spool: Spool }) {
  const stickyColumn = useStickyColumn();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const [allMaterials, setAllMaterials] = useState(false);
  const [allFinishes, setAllFinishes] = useState(false);
  // Open beside the photo on desktop, where there is room; closed on a phone.
  const [detailsOpen, setDetailsOpen] = useState(isDesktop);
  // The fields follow the server's copy (the other person's edit) except the one being typed in, and a
  // save sends only the fields changed here.
  const server = useMemo<Editable>(
    () => ({
      material: spool.material,
      brand: spool.brand,
      colorName: spool.colorName,
      colorHex: spool.colorHex,
      finish: spool.finish,
      remaining: spool.remaining,
      note: spool.note,
      driedAt: spool.driedAt,
      diameterMm: spool.diameterMm,
      nozzleTempMin: spool.nozzleTempMin,
      nozzleTempMax: spool.nozzleTempMax,
      bedTempMin: spool.bedTempMin,
      bedTempMax: spool.bedTempMax,
      dryTempC: spool.dryTempC,
      dryHours: spool.dryHours,
      productCode: spool.productCode,
    }),
    [spool],
  );
  const { value, change, saveState } = useLiveFields<Editable>(server, (changes) =>
    saveSpool(queryClient, spool.id, {
      ...changes,
      ...(changes.material !== undefined && { material: changes.material.trim() || spool.material }),
      ...(changes.brand !== undefined && { brand: changes.brand?.trim() || null }),
      ...(changes.colorName !== undefined && { colorName: changes.colorName?.trim() || null }),
      ...(changes.productCode !== undefined && { productCode: changes.productCode?.trim() || null }),
    }),
  );
  const [placing, setPlacing] = useState(false);
  const [weighing, setWeighing] = useState(false);
  const [settingWeight, setSettingWeight] = useState(false);
  const labelReads = useLabelReadsEnabled();
  // With Claude's key, a photo taken here is the label: it is saved, then read.
  const takePhoto = async (file: File | undefined) => {
    if (!file) return;
    const saved = await setSpoolPhoto(queryClient, spool.id, file);
    if (saved && labelReads) void requestLabelRead(queryClient, spool.id);
  };
  const camera = useFilePicker({ camera: true, onFiles: ([file]) => void takePhoto(file) });
  const library = useFilePicker({ onFiles: ([file]) => void takePhoto(file) });
  // Waiting on Claude with nothing to show for it yet: the title stands in for what is coming.
  // A read that began elsewhere, or before a reload, still fills the page in.
  const isReading = spool.labelRead?.status === "reading";
  // biome-ignore lint/correctness/useExhaustiveDependencies: the query client is stable.
  useEffect(() => {
    if (isReading) pollWhileReading(queryClient);
  }, [isReading]);
  const waiting = spool.labelRead?.status === "reading" && !value.colorName && !spool.fromLabel.length;
  // The marks stay until the field is edited, here or anywhere (the server's copy drops them as it saves).
  const fromLabel = (...fields: LabelField[]) =>
    fields.some(
      (field) =>
        spool.fromLabel.includes(field) && same(value[field as keyof Editable], server[field as keyof Editable]),
    ) ? (
      <FromLabel />
    ) : null;
  const name = spoolName({ ...spool, ...value });
  // Offline, the spool is only for reading (see lib/read-only.ts).
  const readOnly = useReadOnly();

  const remove = () => {
    if (!canEdit()) return;
    deleteSpool(queryClient, spool);
    void navigate({ to: "/pantry" });
  };
  useHotkeys({ spoolBack: () => void navigate({ to: "/pantry" }), spoolDelete: remove });

  const materials: string[] = (SPOOL_MATERIALS as readonly string[]).includes(value.material)
    ? [...SPOOL_MATERIALS]
    : [...SPOOL_MATERIALS, value.material];
  // On desktop a row of ten chips wraps with one orphan, so only the first six show (and the picked one).
  const visibleChips = isDesktop ? 6 : Number.POSITIVE_INFINITY;
  const materialChips = collapseChips(materials, {
    visible: visibleChips,
    picked: (material) => material === value.material,
    expanded: allMaterials,
  });
  const finishChips = collapseChips(FINISHES, {
    visible: visibleChips,
    picked: (finish) => finish === value.finish,
    expanded: allFinishes,
  });

  // What the spool is, as fields: tucked behind "Details" so the page reads as a thing first and a form second.
  const details = (
    <Disclosure
      open={detailsOpen}
      onOpenChange={setDetailsOpen}
      title="Details"
      summary={[value.material, value.finish ? finishLabel(value.finish) : null, value.brand]
        .filter(Boolean)
        .join(" · ")}
      icon={SettingsIcon}
      className="md:max-w-none"
    >
      <fieldset disabled={readOnly} className="flex flex-col gap-7 pt-3">
        <div className="flex flex-col gap-2.5">
          <span className="flex items-baseline gap-2 px-0.5">
            <span className="text-small text-ink-soft font-semibold">Material</span>
            {fromLabel("material")}
          </span>
          {/* biome-ignore lint/a11y/useSemanticElements: a row of chips, not a form field set. */}
          <div className="flex flex-wrap gap-2" role="group" aria-label="Material">
            {materialChips.shown.map((material) => (
              <ToggleChip key={material} selected={value.material === material} onClick={() => change({ material })}>
                {material}
              </ToggleChip>
            ))}
            {materialChips.hidden > 0 && (
              <MoreChip hidden={materialChips.hidden} onClick={() => setAllMaterials(true)} />
            )}
          </div>
        </div>

        <div className="flex items-end gap-3">
          <div className="flex flex-col gap-1.5">
            <span className="flex items-baseline gap-2 px-0.5">
              <span className="text-small text-ink-soft font-semibold">Color</span>
              {fromLabel("colorName", "colorHex")}
            </span>
            <SwatchPicker
              value={value.colorHex ?? undefined}
              onChange={(colorHex) => change({ colorHex })}
              label="Color"
            />
          </div>
          <TextField
            size="sm"
            label="Brand"
            mark={fromLabel("brand")}
            placeholder={waiting ? "" : "Bambu, Polymaker…"}
            maxLength={60}
            value={value.brand ?? ""}
            onChange={(event) => change({ brand: event.target.value || null })}
            className={waiting ? "sg-pulse flex-1" : "flex-1"}
          />
        </div>

        <div className="flex flex-col gap-2.5">
          <span className="flex items-baseline gap-2 px-0.5">
            <span className="text-small text-ink-soft font-semibold">Finish</span>
            {fromLabel("finish")}
          </span>
          {/* biome-ignore lint/a11y/useSemanticElements: a row of chips, not a form field set. */}
          <div className="flex flex-wrap gap-2" role="group" aria-label="Finish">
            {finishChips.shown.map((finish) => (
              <ToggleChip
                key={finish}
                selected={value.finish === finish}
                onClick={() => change({ finish: value.finish === finish ? null : finish })}
              >
                {finishLabel(finish)}
              </ToggleChip>
            ))}
            {finishChips.hidden > 0 && <MoreChip hidden={finishChips.hidden} onClick={() => setAllFinishes(true)} />}
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          <span className="text-small text-ink-soft px-0.5 font-semibold">Printing and drying</span>
          <LabelFacts value={value} onChange={change} mark={fromLabel} />
        </div>
      </fieldset>
    </Disclosure>
  );

  return (
    <article className="pb-6">
      <h1 className="sr-only">{[name.title, name.detail].filter(Boolean).join(", ")}</h1>
      <DetailBar back={back}>
        <SaveStatus state={saveState} className="mr-2" />
        <IconButton icon={TrashIcon} label="Take out of the pantry" disabled={readOnly} onClick={remove} />
      </DetailBar>
      {camera.input}
      {library.input}

      <div className="flex flex-col gap-8 md:flex-row md:items-start md:gap-10 lg:gap-14">
        {/* The spool: its label photo, or the spool itself in its color. */}
        <div ref={stickyColumn} className="sticky-column flex min-w-0 flex-col gap-3 md:flex-2">
          <div className="bg-ink/3 relative -mx-5 aspect-4/3 overflow-hidden md:mx-0 md:aspect-square md:rounded-xl">
            {spool.photo ? (
              <Photo
                src={photoSrc(spool.photo.id, "large")}
                alt={`The label of ${name.title}`}
                color={spool.photo.color || undefined}
                fit="cover"
                className="size-full"
              />
            ) : (
              <div className="flex size-full items-center justify-center">
                <SpoolDisc color={value.colorHex} size="hero" />
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {labelReads ? (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={isDesktop ? SparkleIcon : CameraIcon}
                  disabled={readOnly}
                  onClick={isDesktop ? library.open : camera.open}
                >
                  Read the label
                </Button>
                {!isDesktop && (
                  <Button variant="quiet" size="sm" icon={ImageIcon} disabled={readOnly} onClick={library.open}>
                    Library
                  </Button>
                )}
                {spool.photo && !spool.labelRead && spool.fromLabel.length === 0 && (
                  <Button
                    variant="quiet"
                    size="sm"
                    icon={SparkleIcon}
                    disabled={readOnly}
                    onClick={() => void requestLabelRead(queryClient, spool.id)}
                  >
                    Read this photo
                  </Button>
                )}
              </>
            ) : (
              <>
                {!isDesktop && (
                  <Button variant="secondary" size="sm" icon={CameraIcon} disabled={readOnly} onClick={camera.open}>
                    {spool.photo ? "Retake" : "Snap the label"}
                  </Button>
                )}
                <Button variant="quiet" size="sm" icon={ImageIcon} disabled={readOnly} onClick={library.open}>
                  {spool.photo ? "Another photo" : "Add a photo"}
                </Button>
              </>
            )}
          </div>
          <LabelReadNote spool={spool} readOnly={readOnly} titled={waiting} className="px-0.5" />
          {isDesktop && details}
        </div>

        <div className="flex min-w-0 flex-col gap-7 md:flex-3">
          <div className="flex flex-col gap-1">
            <TextArea
              appearance="title"
              aria-label="Color name"
              placeholder={waiting ? "Reading the label…" : value.material}
              className={waiting ? "sg-pulse" : undefined}
              minRows={1}
              maxLength={60}
              readOnly={readOnly}
              value={value.colorName ?? ""}
              onChange={(event) => change({ colorName: event.target.value.replace(/\n/g, " ") || null })}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === "Escape") {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
              }}
            />
            <MetaList className="text-body text-ink-soft">
              {[
                // While Claude reads an unnamed spool the title says so, and the material isn't said twice.
                ...(waiting ? [] : [name.detail || value.material]),
                ...(spool.slot ? [slotPlace(spool.slot)] : []),
              ].map((piece) => (
                <span key={piece}>{piece}</span>
              ))}
            </MetaList>
          </div>

          <fieldset disabled={readOnly} className="contents">
            {spool.gramsLeft !== null ? (
              <GramsHero
                spool={spool}
                disabled={readOnly}
                onWeigh={() => setWeighing(true)}
                onSetWeight={() => setSettingWeight(true)}
              />
            ) : (
              <div className="flex flex-col gap-2.5">
                <div className="flex min-h-8 items-center justify-between gap-3 md:max-w-md">
                  <span className="text-small text-ink-soft px-0.5 font-semibold">How much is left</span>
                  <Button variant="quiet" size="sm" onClick={() => setSettingWeight(true)}>
                    Count in grams
                  </Button>
                </div>
                <SegmentedControl<Remaining>
                  label="How much is left"
                  labelHidden
                  options={REMAINING.map((level) => ({ value: level, label: REMAINING_LABELS[level] }))}
                  value={value.remaining}
                  onChange={(remaining) => change({ remaining })}
                  className="w-full md:max-w-md"
                />
              </div>
            )}

            {spool.netGrams !== null && fromLabel("netGrams") && (
              <p className="text-small text-ink-soft flex flex-wrap items-baseline gap-x-2 px-0.5">
                Net weight {gramsText(spool.netGrams)} {fromLabel("netGrams")}
              </p>
            )}

            {/* A label with its actions beside it, and what it says below at full width, so it never wraps under them. */}
            <div className="flex flex-col gap-0.5 md:max-w-md">
              <div className="flex min-h-8 items-center justify-between gap-3">
                <span className="text-small text-ink-soft font-semibold">In the printer</span>
                <div className="flex items-center gap-1.5">
                  <Button variant="secondary" size="sm" onClick={() => setPlacing(true)}>
                    {spool.slot ? "Move" : "Load it"}
                  </Button>
                  {spool.slot && (
                    <Button
                      variant="quiet"
                      size="sm"
                      onClick={() => spool.slot && void loadSlot(queryClient, spool.slot, null)}
                    >
                      Take out
                    </Button>
                  )}
                </div>
              </div>
              <span className="text-body text-ink">
                {spool.slot ? `Loaded ${slotPlace(spool.slot)}` : "Not loaded"}
              </span>
            </div>

            <div className="flex flex-col gap-0.5 md:max-w-md">
              <div className="flex min-h-8 items-center justify-between gap-3">
                <span className="text-small text-ink-soft font-semibold">Dried</span>
                <ToggleChip
                  tone="semolina"
                  icon={DriedIcon}
                  selected={!!value.driedAt && Date.now() - value.driedAt < 12 * 3_600_000}
                  onClick={() =>
                    change({
                      driedAt: value.driedAt && Date.now() - value.driedAt < 12 * 3_600_000 ? null : Date.now(),
                    })
                  }
                >
                  Dried it today
                </ToggleChip>
              </div>
              <span className="text-body text-ink">
                {value.driedAt ? `Last dried ${inlineTime(value.driedAt)}` : "Not dried yet"}
              </span>
              <DryIt spool={{ ...spool, driedAt: value.driedAt, material: value.material }} />
            </div>
          </fieldset>
          <NoteField
            value={value.note}
            readOnly={readOnly}
            onChange={(note) => change({ note })}
            placeholder="How it prints, what it likes: 215 °C, slow first layer, dry it first…"
          />
          {/* On phones, right under the note: editing stays close however long the history grows. */}
          {!isDesktop && details}

          {/* The spool's sections, a section's distance apart and from the note above. */}
          <div className="mt-5 flex flex-col gap-12 empty:hidden md:gap-16">
            <UsedBy spool={spool} />
            <SpoolRecipes material={value.material} finish={value.finish} />
            <PrintedWith spool={spool} />
          </div>
        </div>
      </div>

      <WeighSheet spool={spool} open={weighing} onOpenChange={setWeighing} />
      <SetWeightSheet spool={spool} open={settingWeight} onOpenChange={setSettingWeight} />
      <Sheet
        open={placing}
        onOpenChange={setPlacing}
        title={spool.slot ? "Move it" : "Load it"}
        description="Pick the slot it sits in. Whatever was there comes out."
      >
        <AmsLoadout
          onSlot={(slot) => {
            void loadSlot(queryClient, slot, spool.id);
            setPlacing(false);
          }}
        />
      </Sheet>
    </article>
  );
}

/** The recipes saved for this kind of filament: "Recipes for silk PLA", matched by material and finish. */
function SpoolRecipes({ material, finish }: { material: string; finish: string | null }) {
  const recipes = recipesFor(useRecipes(), { material, finish });
  const kind = [finish ? finishLabel(finish).toLowerCase() : null, material.trim()].filter(Boolean).join(" ");
  return <LazyRecipeShelf recipes={recipes} title={`Recipes for ${kind}`} />;
}

/** "How does this silk PLA behave": every attempt printed with it, and how they went. */
function PrintedWith({ spool }: { spool: Spool }) {
  const { data: hits, isPending } = useQuery(spoolAttemptsQuery(spool.id));
  const counts = OUTCOMES.map((outcome) => ({
    outcome,
    count: hits?.filter((hit) => hit.attempt.outcome === outcome).length ?? 0,
  })).filter((entry) => entry.count > 0);
  return (
    <Section
      id="printed-with"
      title="Printed with it"
      count={hits?.length || undefined}
      description={
        counts.length > 0 && (
          <MetaList className="text-small text-ink-faint">
            {counts.map(({ outcome, count }) => (
              <span key={outcome}>
                {count} {OUTCOME_LABELS[outcome].toLowerCase()}
              </span>
            ))}
          </MetaList>
        )
      }
    >
      {isPending ? (
        <div aria-hidden>
          <RowSkeleton />
          <RowSkeleton />
        </div>
      ) : !hits?.length ? (
        <EmptyState
          className="bg-ink/3 max-w-none rounded-xl px-4 py-8"
          illustration={<SpoolStrand />}
          title="Still on the reel"
        >
          Pick this spool for an attempt's filament, and its prints gather here.
        </EmptyState>
      ) : (
        <ul className="-mx-2 flex flex-col gap-1">
          {hits.map((hit) => (
            <li key={hit.attempt.id}>
              <AttemptResult hit={hit} terms={[]} selected={false} onHover={() => undefined} onOpen={() => undefined} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
