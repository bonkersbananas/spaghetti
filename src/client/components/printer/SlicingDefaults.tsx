import { DEFAULT_SLICER, DEFAULT_SLICING } from "@shared/slicing/defaults.ts";
import {
  type SlicingDefaults as Defaults,
  patternWords,
  qualityWords,
  slicerWords,
  slicingFor,
  strengthOf,
  strengthWords,
  supportWords,
} from "@shared/slicing/settings.ts";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Disclosure } from "@/components/ui/Disclosure";
import { MetaList } from "@/components/ui/MetaList";
import { SaveStatus } from "@/components/ui/SaveStatus";
import { Section } from "@/components/ui/Section";
import { Skeleton } from "@/components/ui/Skeleton";
import { savePrinterSetup } from "@/lib/pantry";
import { printerQuery } from "@/lib/pantry-queries";
import { useReadOnly } from "@/lib/read-only";
import { useLiveFields } from "@/lib/use-autosave";

// The settings sheet's chunk (its tiles and glyphs) loads only from here: were it the Printer page's own lazy import,
// the page's first load would carry the list of files to preload with it.
const loadTiles = () => import("@/components/builds/SliceSettings");
const WorkspaceSlicing = lazy(() => loadTiles().then((m) => ({ default: m.WorkspaceSlicing })));

/**
 * "Standard quality · Everyday strength · no supports": the defaults in the model card's words, while folded, with
 * the slicer when it isn't the usual one ("Spaghetti's own slicer", decision 0055).
 */
function defaultsWords(value: Defaults | null): string[] {
  const settings = slicingFor(value ?? {}, DEFAULT_SLICING);
  const strength = strengthOf(settings);
  return [
    qualityWords(settings.layerHeight),
    strength
      ? strengthWords(strength)
      : `${settings.walls} walls, ${settings.infill}% ${patternWords(settings.pattern)}`,
    supportWords(settings) || "no supports",
    ...(settings.slicer !== DEFAULT_SLICER ? [slicerWords(settings.slicer)] : []),
  ];
}

/**
 * The workspace's slicing defaults on the Printer page (decision 0051): how a model nobody set up is sliced here.
 * Set once and seldom changed, they are folded, as "Staying dry" is, their summary in the model card's words; open,
 * the same tiles as a model's settings. It reads the printer's setup and saves only its `slicing` (null: Spaghetti's
 * own), with its own save status, so the page can place it anywhere. It suspends until the setup is here: the page
 * shows SlicingDefaultsSkeleton until then.
 */
export function SlicingDefaults() {
  const queryClient = useQueryClient();
  const { data } = useSuspenseQuery(printerQuery);
  const slicing = data.setup.slicing ?? null;
  const server = useMemo(() => ({ slicing }), [slicing]);
  const { value, change, saveState } = useLiveFields<{ slicing: Defaults | null }>(server, (changes) =>
    savePrinterSetup(queryClient, changes),
  );
  // Here, through the form; once the page is gone (the reset's Undo, from its toast), straight to the server.
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const setDefaults = useCallback(
    (next: Defaults | null) =>
      live.current ? change({ slicing: next }) : void savePrinterSetup(queryClient, { slicing: next }),
    [change, queryClient],
  );
  const [open, setOpen] = useState(false);
  // The tiles' code, before the first tap opens them.
  useEffect(() => {
    void loadTiles();
  }, []);
  // Offline, the setup is only for reading (lib/read-only.ts).
  const readOnly = useReadOnly();
  return (
    <Section id="printer-slicing" title="Slicing" size="title" aside={<SaveStatus state={saveState} />}>
      <Disclosure
        open={open}
        onOpenChange={setOpen}
        title="How new models are sliced"
        summary={<MetaList>{defaultsWords(value.slicing)}</MetaList>}
      >
        <fieldset disabled={readOnly} className="min-w-0 pt-3">
          {/* Why the tiles are dimmed: offline the setup is for reading only. */}
          {readOnly && (
            <p className="text-small text-ink-soft mb-5 text-pretty">
              Offline: you can read these, and change them once you're back online.
            </p>
          )}
          <Suspense fallback={<TilesSkeleton />}>
            <WorkspaceSlicing value={value.slicing ?? undefined} onChange={setDefaults} />
          </Suspense>
        </fieldset>
      </Disclosure>
    </Section>
  );
}

/** The tiles before their code arrives (seldom: it loads with the section): quality's four, then three and three. */
function TilesSkeleton() {
  return (
    <div className="flex flex-col gap-7" aria-hidden>
      {[4, 3, 3].map((tiles, row) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a fixed number of rows that never move.
        <div key={row} className="flex flex-col gap-2.5">
          <Skeleton className="h-4 w-20" />
          <div className={tiles === 4 ? "grid grid-cols-2 gap-2 md:grid-cols-4" : "grid grid-cols-3 gap-2"}>
            {Array.from({ length: tiles }, (_, tile) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a fixed number of identical tiles.
              <Skeleton key={tile} className="h-24 rounded-lg md:h-22" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
