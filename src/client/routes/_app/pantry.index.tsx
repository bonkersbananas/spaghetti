import type { Spool } from "@shared/api";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { PantryJar } from "@/components/illustrations";
import { AddSpoolSheet } from "@/components/pantry/AddSpoolSheet";
import { AmsLoadout } from "@/components/pantry/Ams";
import { SpoolCard } from "@/components/pantry/SpoolCard";
import { PageHeader } from "@/components/shell/PageHeader";
import { ActionBar } from "@/components/ui/ActionBar";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PlusIcon, PrinterIcon } from "@/components/ui/icons";
import { AddPhotoTile } from "@/components/ui/PhotoTiles";
import { CardSkeleton, Skeleton } from "@/components/ui/Skeleton";
import { shortcutCaps, useHotkeys } from "@/lib/hotkeys";
import { loadSlot, spoolsQuery } from "@/lib/pantry";
import { canEdit, useReadOnly } from "@/lib/read-only";
import { useIsDesktop } from "@/lib/use-media-query";

export const Route = createFileRoute("/_app/pantry/")({
  validateSearch: (search: Record<string, unknown>): { add?: boolean } =>
    search.add === true || search.add === "true" ? { add: true } : {},
  component: Pantry,
});

const grid = "grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-5 xl:grid-cols-5";

/** Spools grouped by material, the most stocked first; the empty ones last. */
function groups(spools: Spool[]): Array<{ material: string; spools: Spool[] }> {
  const byMaterial = new Map<string, Spool[]>();
  for (const spool of spools) {
    const key = spool.material.trim().toUpperCase();
    byMaterial.set(key, [...(byMaterial.get(key) ?? []), spool]);
  }
  const order = (spool: Spool) => (spool.remaining === "empty" ? 1 : 0);
  return [...byMaterial.entries()]
    .map(([material, list]) => ({
      material,
      spools: list.sort((a, b) => order(a) - order(b) || (a.colorName ?? "").localeCompare(b.colorName ?? "")),
    }))
    .sort((a, b) => b.spools.length - a.spools.length || a.material.localeCompare(b.material));
}

function Pantry() {
  const queryClient = useQueryClient();
  const isDesktop = useIsDesktop();
  const { data: spools, isPending } = useQuery(spoolsQuery);
  const { add } = Route.useSearch();
  const [adding, setAdding] = useState<{ open: boolean; slot: string | null }>({ open: !!add, slot: null });
  // Offline, the pantry is only for reading (see lib/read-only.ts).
  const readOnly = useReadOnly();
  const openAdd = (slot: string | null = null) => canEdit() && setAdding({ open: true, slot });
  useHotkeys({ pantryAdd: () => openAdd() });

  const loaded = spools?.filter((spool) => spool.slot).length ?? 0;
  const subtitle = spools?.length
    ? `${spools.length} ${spools.length === 1 ? "spool" : "spools"} on hand, ${loaded} loaded in the printer.`
    : "Every spool on hand, and what's loaded in the AMS.";

  return (
    <>
      <PageHeader
        title="Pantry"
        subtitle={subtitle}
        actions={
          <>
            <Link to="/printer" className="focus-ring rounded-md">
              <Button variant="quiet" icon={PrinterIcon} tabIndex={-1}>
                Printer
              </Button>
            </Link>
            <Button
              variant="secondary"
              icon={PlusIcon}
              shortcut={shortcutCaps("pantryAdd")}
              disabled={readOnly}
              onClick={() => openAdd()}
            >
              Add spool
            </Button>
          </>
        }
      />
      {isPending ? (
        <div className="flex flex-col gap-10" aria-hidden>
          <Skeleton className="h-44 w-full rounded-xl md:max-w-2xl" />
          <div className={grid}>
            {Array.from({ length: 4 }, (_, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity.
              <CardSkeleton key={index} aspect="square" />
            ))}
          </div>
        </div>
      ) : !spools?.length ? (
        <EmptyState
          className="py-10 md:py-20"
          illustration={<PantryJar />}
          title="The pantry's bare"
          action={
            <Button
              variant={isDesktop ? "secondary" : "primary"}
              icon={PlusIcon}
              disabled={readOnly}
              onClick={() => openAdd()}
            >
              Add a spool
            </Button>
          }
        >
          Add the spools on your shelf: snap the label, pick a material and a color. Then attempts can pick their
          filament from here, and each spool remembers how its prints went.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-12 md:gap-16">
          <section aria-labelledby="loaded" className="flex flex-col gap-4 md:gap-5">
            <div className="flex items-baseline justify-between gap-3">
              <h2 id="loaded" className="text-headline text-ink">
                In the printer
              </h2>
              {isDesktop && (
                <p className="text-small text-ink-faint">Drag a spool onto a slot, or click a slot to change it.</p>
              )}
            </div>
            <AmsLoadout readOnly={readOnly} onAddSpool={(slot) => openAdd(slot)} />
          </section>
          {groups(spools).map((group) => (
            <section
              key={group.material}
              aria-labelledby={`material-${group.material}`}
              className="flex flex-col gap-4"
            >
              <h2 id={`material-${group.material}`} className="text-title text-ink-soft">
                {group.material}{" "}
                <span className="text-ink-faint text-small tabular align-middle font-sans font-semibold">
                  {group.spools.length}
                </span>
              </h2>
              <ul className={grid} aria-label={`${group.material} spools`}>
                {group.spools.map((spool) => (
                  <SpoolCard key={spool.id} spool={spool} draggable={isDesktop && !readOnly} />
                ))}
              </ul>
            </section>
          ))}
          {isDesktop && (
            <div className={grid}>
              <AddPhotoTile
                size="card"
                icon={PlusIcon}
                label="Add spool"
                disabled={readOnly}
                onClick={() => openAdd()}
              />
            </div>
          )}
        </div>
      )}
      {!isDesktop && (spools?.length ?? 0) > 0 && (
        <ActionBar>
          <Button variant="primary" size="lg" icon={PlusIcon} fullWidth disabled={readOnly} onClick={() => openAdd()}>
            Add spool
          </Button>
        </ActionBar>
      )}
      <AddSpoolSheet
        open={adding.open}
        onOpenChange={(open) => setAdding((current) => ({ ...current, open }))}
        description={
          adding.slot
            ? `It goes straight into ${adding.slot === "Ext" ? "the external holder" : `slot ${adding.slot}`}.`
            : undefined
        }
        onAdded={(spool, saved) => {
          if (adding.slot) void loadSlot(queryClient, adding.slot, spool.id, saved);
        }}
      />
    </>
  );
}
