import type { Spool } from "@shared/api";
import { amsUnitLetters, EXTERNAL_SLOT, spoolName, unitSlots } from "@shared/spools";
import { daysAgo } from "@shared/time";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type DragEvent, useState } from "react";
import { Button } from "@/components/ui/Button";
import { DriedIcon, PlusIcon } from "@/components/ui/icons";
import { MetaList } from "@/components/ui/MetaList";
import { RemainingMeter } from "@/components/ui/RemainingMeter";
import { Sheet } from "@/components/ui/Sheet";
import { SpoolDisc } from "@/components/ui/SpoolDisc";
import { cn } from "@/lib/cn";
import { loadSlot, printerQuery, spoolsQuery } from "@/lib/pantry";

/** The drag type for a spool being moved onto a slot. */
export const SPOOL_DRAG_TYPE = "application/x-spaghetti-spool";

/** Lets a spool card be dragged onto an AMS slot (desktop). */
export function spoolDragProps(spoolId: string, fromSlot?: string | null) {
  return {
    draggable: true,
    onDragStart: (event: DragEvent) => {
      event.dataTransfer.setData(SPOOL_DRAG_TYPE, JSON.stringify({ spoolId, fromSlot: fromSlot ?? null }));
      event.dataTransfer.effectAllowed = "move";
    },
  };
}

function readDrag(event: DragEvent): { spoolId: string; fromSlot: string | null } | null {
  try {
    const raw = event.dataTransfer.getData(SPOOL_DRAG_TYPE);
    return raw ? (JSON.parse(raw) as { spoolId: string; fromSlot: string | null }) : null;
  } catch {
    return null;
  }
}

interface SlotProps {
  slot: string;
  spool: Spool | undefined;
  onOpen: (slot: string) => void;
  onDropSpool: (slot: string, spoolId: string, fromSlot: string | null) => void;
  /** "bay": a tall slot in an AMS unit; "row": the external spool, a wide row. */
  shape?: "bay" | "row";
  readOnly?: boolean;
}

/** One slot: the spool in it, drawn as a spool, or an empty bay. Tap to change it, or drop a spool on it. */
function Slot({ slot, spool, onOpen, onDropSpool, shape = "bay", readOnly }: SlotProps) {
  const [over, setOver] = useState(false);
  const name = spool ? spoolName(spool) : null;
  return (
    <button
      type="button"
      data-slot={slot}
      onClick={() => onOpen(slot)}
      disabled={readOnly}
      {...(spool && !readOnly ? spoolDragProps(spool.id, slot) : {})}
      onDragOver={(event) => {
        if (readOnly || !event.dataTransfer.types.includes(SPOOL_DRAG_TYPE)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        setOver(false);
        const dragged = readDrag(event);
        if (!dragged) return;
        event.preventDefault();
        if (dragged.fromSlot !== slot) onDropSpool(slot, dragged.spoolId, dragged.fromSlot);
      }}
      className={cn(
        "pressable focus-ring bg-ink/4 shadow-well duration-fast relative flex min-w-0 rounded-lg transition-shadow disabled:cursor-default",
        !readOnly && "hover:bg-ink/6",
        over && "shadow-ring bg-semolina-soft/60",
        shape === "bay"
          ? // Tall on phones and laptops; from lg a row like the external holder, so the tile fills edge to edge.
            "flex-col items-center gap-2 px-1.5 pt-3 pb-2.5 md:px-2 md:pt-4 lg:flex-row lg:gap-3 lg:px-3 lg:py-3 lg:text-left"
          : "w-full items-center gap-3 px-3 py-2.5 text-left",
      )}
    >
      <SpoolDisc color={spool?.colorHex} empty={!spool} size={shape === "bay" ? "lg" : "md"} />
      <span
        className={cn(
          "flex min-w-0 flex-col",
          shape === "bay" ? "w-full items-center text-center lg:flex-1 lg:items-start lg:text-left" : "flex-1",
        )}
      >
        <span className="text-caption text-ink-faint tabular font-semibold tracking-wider uppercase">
          {slot === EXTERNAL_SLOT ? "External" : slot}
        </span>
        <span
          className={cn(
            "block w-full min-w-0 font-semibold",
            // A bay is narrow on a phone: the name steps down a size and may take two lines, breaking between
            // words, rather than lose its end ("Sunflow…").
            shape === "bay"
              ? "text-caption md:text-small line-clamp-2 break-words lg:line-clamp-1"
              : "text-small truncate",
            spool ? "text-ink" : "text-ink-faint",
          )}
        >
          {spool ? (name?.title ?? spool.material) : "Empty"}
        </span>
        {spool && (
          <>
            <span
              className={cn(
                "text-caption text-ink-faint block w-full min-w-0 truncate",
                // From lg, a dried spool says so beside its material (below).
                shape === "bay" && !!spool.driedAt && "lg:hidden",
              )}
            >
              {spool.colorName ? spool.material : (spool.brand ?? "")}
            </span>
            {shape === "bay" && spool.driedAt && (
              <MetaList className="text-caption text-ink-faint hidden w-full lg:block">
                <span>{spool.colorName ? spool.material : (spool.brand ?? "")}</span>
                <span className="inline-flex items-center gap-1 whitespace-nowrap">
                  <DriedIcon size={12} aria-hidden />
                  <span className="sr-only">Dried </span>
                  {daysAgo(spool.driedAt)}
                </span>
              </MetaList>
            )}
            {shape === "bay" && (
              <RemainingMeter
                remaining={spool.remaining}
                // A spool that is still loaded but empty says so in words at every width.
                showLabel={spool.remaining === "empty" ? true : "lg"}
                className="mt-1 self-center lg:mt-0.5 lg:self-start"
              />
            )}
          </>
        )}
      </span>
      {spool && shape === "row" && <RemainingMeter remaining={spool.remaining} showLabel="lg" />}
    </button>
  );
}

interface AmsLoadoutProps {
  /** Show only, no changing (a spool's page links to the pantry instead). */
  readOnly?: boolean;
  /** Tapping a slot: by default, opens the slot's sheet to pick a spool. */
  onSlot?: (slot: string, spool: Spool | undefined) => void;
  /** "Add a spool" from an empty slot's sheet: the new spool goes into that slot. */
  onAddSpool?: (slot: string) => void;
  className?: string;
}

/**
 * The AMS as it is loaded: each unit's four slots with their spools' colors,
 * and the external spool holder. Tap a slot to change it; on desktop, drag a
 * spool from the pantry (or another slot) onto it.
 */
export function AmsLoadout({ readOnly, onSlot, onAddSpool, className }: AmsLoadoutProps) {
  const queryClient = useQueryClient();
  const printer = useQuery(printerQuery);
  const spools = useQuery(spoolsQuery);
  const [picking, setPicking] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const byId = new Map((spools.data ?? []).map((spool) => [spool.id, spool]));
  const slots = printer.data?.slots ?? {};
  const spoolIn = (slot: string) => {
    const id = slots[slot];
    return id ? byId.get(id) : undefined;
  };
  const units = amsUnitLetters(printer.data?.setup.amsUnits ?? 1);

  const open = (slot: string) => {
    if (onSlot) return onSlot(slot, spoolIn(slot));
    setPicking(slot);
    setSheetOpen(true);
  };
  const drop = (slot: string, spoolId: string, fromSlot: string | null) => {
    const previous = slots[slot];
    void loadSlot(queryClient, slot, spoolId).then(() => {
      // Dragged from another slot onto a full one: they swap.
      if (fromSlot && previous && previous !== spoolId) void loadSlot(queryClient, fromSlot, previous);
    });
  };

  return (
    <div className={cn("flex flex-col gap-3 md:gap-4", className)}>
      {units.map((letter) => {
        const loaded = unitSlots(letter).filter((slot) => spoolIn(slot)).length;
        return (
          <section key={letter} aria-label={`AMS ${letter}`} className="bg-cream shadow-soft rounded-xl p-3 md:p-4">
            <div className="mb-3 flex items-baseline justify-between gap-3 px-1">
              <h3 className="text-small text-ink font-sans font-semibold">AMS {letter}</h3>
              <span className="text-caption text-ink-faint">AMS 2 Pro · {loaded} of 4 loaded</span>
            </div>
            <div className="grid grid-cols-4 gap-2 md:gap-3">
              {unitSlots(letter).map((slot) => (
                <Slot
                  key={slot}
                  slot={slot}
                  spool={spoolIn(slot)}
                  onOpen={open}
                  onDropSpool={drop}
                  readOnly={readOnly}
                />
              ))}
            </div>
          </section>
        );
      })}
      <section aria-label="External spool" className="bg-cream shadow-soft rounded-xl p-2">
        <Slot
          slot={EXTERNAL_SLOT}
          spool={spoolIn(EXTERNAL_SLOT)}
          onOpen={open}
          onDropSpool={drop}
          shape="row"
          readOnly={readOnly}
        />
      </section>
      {!onSlot && !readOnly && (
        <SlotSheet
          slot={picking}
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          spools={spools.data ?? []}
          current={picking ? spoolIn(picking) : undefined}
          onPick={(spoolId) => {
            if (picking) void loadSlot(queryClient, picking, spoolId);
            setSheetOpen(false);
          }}
          onAddSpool={
            onAddSpool && picking
              ? () => {
                  setSheetOpen(false);
                  onAddSpool(picking);
                }
              : undefined
          }
        />
      )}
    </div>
  );
}

interface SlotSheetProps {
  slot: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  spools: Spool[];
  current: Spool | undefined;
  onPick: (spoolId: string | null) => void;
  onAddSpool?: () => void;
}

/** What goes in a slot: any spool from the pantry (one loaded elsewhere moves here), or nothing. */
export function SlotSheet({ slot, open, onOpenChange, spools, current, onPick, onAddSpool }: SlotSheetProps) {
  const sorted = [...spools]
    .filter((spool) => spool.remaining !== "empty" || spool.id === current?.id)
    // What's in it now first, then spools that aren't loaded, then ones in other slots.
    .sort(
      (a, b) =>
        Number(b.id === current?.id) - Number(a.id === current?.id) ||
        Number(!!a.slot) - Number(!!b.slot) ||
        a.material.localeCompare(b.material),
    );
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={slot ? (slot === EXTERNAL_SLOT ? "External spool" : `Slot ${slot}`) : "Slot"}
      description={current ? "Swap in another spool, or take this one out." : "Pick the spool that's in it."}
      footer={
        <>
          {onAddSpool && (
            <Button variant="quiet" icon={PlusIcon} onClick={onAddSpool} className="mr-auto">
              New spool
            </Button>
          )}
          {current && (
            <Button variant="secondary" onClick={() => onPick(null)}>
              Take it out
            </Button>
          )}
        </>
      }
    >
      {sorted.length === 0 ? (
        <p className="text-body text-ink-faint py-4">The pantry is empty. Add a spool first, then load it here.</p>
      ) : (
        <ul className="-mx-2 flex flex-col">
          {sorted.map((spool) => {
            const name = spoolName(spool);
            const here = spool.id === current?.id;
            return (
              <li key={spool.id}>
                <button
                  type="button"
                  onClick={() => onPick(spool.id)}
                  aria-current={here || undefined}
                  className={cn(
                    "pressable focus-ring flex w-full items-center gap-3 rounded-md px-2 py-2.5 text-left",
                    here ? "bg-semolina-soft/60" : "hover:bg-ink/4",
                  )}
                >
                  <SpoolDisc color={spool.colorHex} size="md" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-body text-ink truncate font-semibold">{name.title}</span>
                    {name.detail && <span className="text-small text-ink-faint truncate">{name.detail}</span>}
                  </span>
                  {spool.slot && (
                    <span className="text-small text-ink-faint tabular shrink-0">
                      {here ? "Here now" : spool.slot === "Ext" ? "External" : `In ${spool.slot}`}
                    </span>
                  )}
                  <RemainingMeter remaining={spool.remaining} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Sheet>
  );
}
