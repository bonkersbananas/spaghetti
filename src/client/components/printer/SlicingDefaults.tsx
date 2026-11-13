import type { SlicingDefaults as Defaults } from "@shared/slicing/settings.ts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useMemo } from "react";
import { SaveStatus } from "@/components/ui/SaveStatus";
import { Section } from "@/components/ui/Section";
import { Skeleton } from "@/components/ui/Skeleton";
import { savePrinterSetup } from "@/lib/pantry";
import { printerQuery } from "@/lib/pantry-queries";
import { useReadOnly } from "@/lib/read-only";
import { useLiveFields } from "@/lib/use-autosave";
import { useIdle } from "@/lib/use-idle";

// The defaults share the settings sheet's chunk (its tiles and glyphs), loaded once the page has settled.
const WorkspaceSlicing = lazy(() =>
  import("@/components/builds/SliceSettings").then((m) => ({ default: m.WorkspaceSlicing })),
);

/**
 * The workspace's slicing defaults on the Printer page (decision 0050): how a model nobody set up is sliced here, a
 * section of its own on a cream card, as the nozzles are. It reads the printer's setup and saves only its `slicing`
 * (null: Spaghetti's own), with its own save status, so the page can place it anywhere.
 */
export function SlicingDefaults() {
  const queryClient = useQueryClient();
  const { data } = useQuery(printerQuery);
  const slicing = data?.setup.slicing ?? null;
  const server = useMemo(() => ({ slicing }), [slicing]);
  const { value, change, saveState } = useLiveFields<{ slicing: Defaults | null }>(server, (changes) =>
    savePrinterSetup(queryClient, changes),
  );
  const idle = useIdle();
  // Offline, the setup is only for reading (lib/read-only.ts).
  const readOnly = useReadOnly();
  const loading = <Skeleton className="h-96 rounded-md" />;
  return (
    <Section
      id="printer-slicing"
      title="Slicing"
      size="title"
      description="How Spaghetti slices a model nobody set up."
      aside={<SaveStatus state={saveState} />}
    >
      <fieldset disabled={readOnly} className="bg-cream shadow-soft min-w-0 rounded-lg p-4 md:p-5">
        {idle && data ? (
          <Suspense fallback={loading}>
            <WorkspaceSlicing value={value.slicing ?? undefined} onChange={(next) => change({ slicing: next })} />
          </Suspense>
        ) : (
          loading
        )}
      </fieldset>
    </Section>
  );
}
