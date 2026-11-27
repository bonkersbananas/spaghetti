import type { Spool } from "@shared/api";
import type { UnknownTray } from "@shared/bridge";
import { amsUnitLetters, EXTERNAL_SLOT, softSlashes, spoolName, unitSlots } from "@shared/spools";
import { daysAgo } from "@shared/time";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type DragEvent, lazy, Suspense, useState } from "react";
import { DryIt } from "@/components/pantry/DryIt";
import { OfferChip } from "@/components/ui/ForOffer";
import { DriedIcon, PlusIcon } from "@/components/ui/icons";
import { MetaList } from "@/components/ui/MetaList";
import { RemainingMeter } from "@/components/ui/RemainingMeter";
import { SpoolDisc } from "@/components/ui/SpoolDisc";
import { cn } from "@/lib/cn";
import { loadSlot } from "@/lib/pantry";
import { printerQuery, spoolsQuery } from "@/lib/pantry-queries";
import { useWarmSoon } from "@/lib/warm-soon";

// The slot sheet (and the sheet library behind it) is fetched just after the first screen, or at the first touch.
const loadSlotSheet = () => import("./SlotSheet");
const SlotSheet = lazy(() => loadSlotSheet().then((m) => ({ default: m.SlotSheet })));

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
  /** The printer bridge sees a spool here that the pantry can't place: a gentle prompt to pick one. */
  unknown?: UnknownTray;
}

/** A slot as a drop target for a dragged spool (desktop): whether one is over it, and the handlers. */
function useSlotDrop(slot: string, onDropSpool: SlotProps["onDropSpool"], readOnly?: boolean) {
  const [over, setOver] = useState(false);
  const handlers = {
    onDragOver: (event: DragEvent) => {
      if (readOnly || !event.dataTransfer.types.includes(SPOOL_DRAG_TYPE)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setOver(true);
    },
    onDragLeave: () => setOver(false),
    onDrop: (event: DragEvent) => {
      setOver(false);
      const dragged = readDrag(event);
      if (!dragged) return;
      event.preventDefault();
      if (dragged.fromSlot !== slot) onDropSpool(slot, dragged.spoolId, dragged.fromSlot);
    },
  };
  return { over, handlers };
}

/**
 * An empty bay in its place in the unit, quiet: only its faint label and a small plus on a soft inset, no bay surface,
 * no dashed ring, so what is loaded leads while every slot keeps the position it has on the machine. The whole column
 * opens the slot's sheet, and takes a dropped spool on desktop.
 */
function QuietSlot({
  slot,
  onOpen,
  onDropSpool,
  readOnly,
}: Pick<SlotProps, "slot" | "onOpen" | "onDropSpool" | "readOnly">) {
  const { over, handlers } = useSlotDrop(slot, onDropSpool, readOnly);
  return (
    <button
      type="button"
      data-slot={slot}
      data-empty=""
      aria-label={`${slot} empty, load a spool`}
      onClick={() => onOpen(slot)}
      disabled={readOnly}
      {...handlers}
      className={cn(
        "pressable focus-ring bg-ink/2 text-ink-faint duration-fast flex min-h-16 min-w-0 flex-col items-center justify-center gap-1.5 rounded-lg py-3 transition-colors disabled:cursor-default",
        !readOnly && "hover:bg-ink/5 hover:text-ink-soft",
        over && "shadow-ring bg-semolina-soft/60 text-semolina-ink",
      )}
    >
      <span className="text-caption tabular font-semibold tracking-wider uppercase">{slot}</span>
      {!readOnly && <PlusIcon size={16} weight="bold" aria-hidden />}
    </button>
  );
}

/** One slot: the spool in it, drawn as a spool, or an empty bay. Tap to change it, or drop a spool on it. */
function Slot({ slot, spool, onOpen, onDropSpool, shape = "bay", readOnly, unknown }: SlotProps) {
  const { over, handlers } = useSlotDrop(slot, onDropSpool, readOnly);
  const name = spool ? spoolName(spool) : null;
  return (
    <button
      type="button"
      data-slot={slot}
      data-unknown={unknown ? "" : undefined}
      onClick={() => onOpen(slot)}
      disabled={readOnly}
      {...(spool && !readOnly ? spoolDragProps(spool.id, slot) : {})}
      {...handlers}
      className={cn(
        "pressable focus-ring bg-ink/4 shadow-well duration-fast relative flex min-w-0 rounded-lg transition-shadow disabled:cursor-default",
        !readOnly && "hover:bg-ink/6",
        over && "shadow-ring bg-semolina-soft/60",
        shape === "bay"
          ? // Tall on phones and laptops; in a wide enough unit (container, not screen) a row like the external holder, so the tile fills edge to edge.
            "flex-col items-center gap-2 px-1.5 pt-3 pb-2.5 md:px-2 md:pt-4 @3xl:flex-row @3xl:gap-3 @3xl:px-3 @3xl:py-3 @3xl:text-left"
          : "w-full items-center gap-3 px-3 py-2.5 text-left",
      )}
    >
      <SpoolDisc
        color={spool?.colorHex ?? unknown?.colorHex}
        colors={spool?.colors}
        empty={!spool && !unknown}
        size={shape === "bay" ? "lg" : "md"}
      />
      <span
        className={cn(
          "flex min-w-0 flex-col",
          shape === "bay" ? "w-full flex-1 items-center text-center @3xl:items-start @3xl:text-left" : "flex-1",
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
              ? cn("text-caption md:text-small break-words", unknown && !spool ? "" : "line-clamp-2 @3xl:line-clamp-1")
              : "text-small truncate",
            spool ? "text-ink" : "text-ink-faint",
          )}
        >
          {spool ? softSlashes(name?.title ?? spool.material) : unknown ? "Which spool?" : "Empty"}
        </span>
        {!spool && unknown && (
          <span className="text-caption text-ink-soft block w-full min-w-0 font-medium">
            Printer sees {unknown.material ?? "a spool"}
          </span>
        )}
        {spool && (
          <>
            <span
              className={cn(
                "text-caption text-ink-faint block w-full min-w-0 truncate",
                // From a wide unit, a dried spool says so beside its material (below).
                shape === "bay" && !!spool.driedAt && "@3xl:hidden",
              )}
            >
              {spool.colorName ? spool.material : (spool.brand ?? "")}
            </span>
            {shape === "bay" && spool.driedAt && (
              <MetaList className="text-caption text-ink-faint hidden w-full @3xl:block">
                <span>{spool.colorName ? spool.material : (spool.brand ?? "")}</span>
                <span className="inline-flex items-center gap-1 whitespace-nowrap">
                  <DriedIcon size={12} aria-hidden />
                  <span className="sr-only">Dried </span>
                  {daysAgo(spool.driedAt)}
                </span>
              </MetaList>
            )}
            <DryIt
              spool={spool}
              compact
              className={shape === "bay" ? "justify-center @3xl:justify-start" : "self-start"}
            />
            {shape === "bay" && (
              <RemainingMeter
                remaining={spool.remaining}
                gramsLeft={spool.gramsLeft}
                // A spool that is still loaded but empty says so in words at every width, and grams always show.
                showLabel={spool.remaining === "empty" || spool.gramsLeft !== null ? true : "wide"}
                stacked
                // Pinned to the bottom of the tile, so the four meters sit on one line when a name wraps.
                className="mt-auto self-center pt-1 @3xl:mt-0.5 @3xl:self-start @3xl:pt-0"
              />
            )}
          </>
        )}
      </span>
      {spool && shape === "row" && <RemainingMeter remaining={spool.remaining} gramsLeft={spool.gramsLeft} showLabel />}
    </button>
  );
}

/**
 * The external holder when it is empty: one quiet line in its place ("External · + Load"), an offer rather than a
 * row of nothing. The line takes a dropped spool on desktop.
 */
function QuietExternal({ onOpen, onDropSpool, readOnly }: Pick<SlotProps, "onOpen" | "onDropSpool" | "readOnly">) {
  const { over, handlers } = useSlotDrop(EXTERNAL_SLOT, onDropSpool, readOnly);
  return (
    <section
      aria-label="External spool"
      data-slot={EXTERNAL_SLOT}
      data-empty=""
      {...handlers}
      className={cn(
        "duration-fast flex items-center gap-3 rounded-xl px-4 py-1 transition-shadow",
        over && "shadow-ring bg-semolina-soft/60",
      )}
    >
      <span className="text-caption text-ink-faint tabular font-semibold tracking-wider uppercase">External</span>
      <OfferChip aria-label="External empty, load a spool" disabled={readOnly} onClick={() => onOpen(EXTERNAL_SLOT)}>
        Load
      </OfferChip>
    </section>
  );
}

interface AmsLoadoutProps {
  /** Show only, no changing (a spool's page links to the pantry instead). */
  readOnly?: boolean;
  /**
   * Tapping a slot: by default, opens the slot's sheet to pick a spool. Given (picking where a spool goes), every
   * slot is drawn as a bay, the empty ones too, since an empty one is what people are looking for.
   */
  onSlot?: (slot: string, spool: Spool | undefined) => void;
  /** "Add a spool" from an empty slot's sheet: the new spool goes into that slot. */
  onAddSpool?: (slot: string) => void;
  /** What is loaded where, in place of the printer's own (the styleguide's states). */
  slots?: Record<string, string>;
  className?: string;
}

/**
 * The AMS as it is loaded: each unit as its four slots in their places, the loaded ones as bays with their spools'
 * colors and the empty ones quiet (a faint label and a plus), and the external spool holder (a row, or one quiet
 * "External · + Load" line when it is empty). Tap a slot to change it; on desktop, drag a spool from the pantry (or
 * another slot) onto it.
 */
export function AmsLoadout({ readOnly, onSlot, onAddSpool, slots: given, className }: AmsLoadoutProps) {
  const queryClient = useQueryClient();
  const printer = useQuery(printerQuery);
  const spools = useQuery(spoolsQuery);
  const [picking, setPicking] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetAsked, setSheetAsked] = useState(false);
  if (sheetOpen && !sheetAsked) setSheetAsked(true);
  useWarmSoon(loadSlotSheet);
  const byId = new Map((spools.data ?? []).map((spool) => [spool.id, spool]));
  const slots = given ?? printer.data?.slots ?? {};
  const unknownTray = (slot: string) => printer.data?.bridge?.unknownTrays.find((tray) => tray.slot === slot);
  const spoolIn = (slot: string) => {
    const id = slots[slot];
    return id ? byId.get(id) : undefined;
  };
  // Empty slots are drawn quiet in their places; picking where a spool goes (onSlot) draws every bay as a bay.
  const quiet = !onSlot;
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
    <div className={cn("flex flex-col gap-3 md:gap-4", className)} data-ams>
      {units.map((letter) => {
        const loaded = unitSlots(letter).filter((slot) => spoolIn(slot)).length;
        return (
          <section
            key={letter}
            aria-label={`AMS ${letter}`}
            className="bg-cream shadow-soft @container rounded-xl p-3 md:p-4"
          >
            <div className="mb-3 flex items-baseline justify-between gap-3 px-1">
              <h3 className="text-small text-ink font-sans font-semibold">AMS {letter}</h3>
              <span className="text-caption text-ink-faint">AMS 2 Pro · {loaded} of 4 loaded</span>
            </div>
            {/* Four fixed columns in slot order, as on the machine: people load by position. */}
            <div className="grid grid-cols-4 gap-2 md:gap-3">
              {unitSlots(letter).map((slot) =>
                quiet && !spoolIn(slot) && !unknownTray(slot) ? (
                  <QuietSlot key={slot} slot={slot} onOpen={open} onDropSpool={drop} readOnly={readOnly} />
                ) : (
                  <Slot
                    key={slot}
                    slot={slot}
                    spool={spoolIn(slot)}
                    onOpen={open}
                    onDropSpool={drop}
                    readOnly={readOnly}
                    unknown={unknownTray(slot)}
                  />
                ),
              )}
            </div>
            {quiet && loaded === 0 && !unitSlots(letter).some(unknownTray) && (
              <p className="text-small text-ink-faint mt-3 px-1">An empty pot. Pick a slot to load a spool.</p>
            )}
          </section>
        );
      })}
      {quiet && !spoolIn(EXTERNAL_SLOT) && !unknownTray(EXTERNAL_SLOT) ? (
        <QuietExternal onOpen={open} onDropSpool={drop} readOnly={readOnly} />
      ) : (
        <section aria-label="External spool" className="bg-cream shadow-soft rounded-xl p-2">
          <Slot
            slot={EXTERNAL_SLOT}
            spool={spoolIn(EXTERNAL_SLOT)}
            onOpen={open}
            onDropSpool={drop}
            shape="row"
            readOnly={readOnly}
            unknown={unknownTray(EXTERNAL_SLOT)}
          />
        </section>
      )}
      {!onSlot && !readOnly && sheetAsked && (
        <Suspense fallback={null}>
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
        </Suspense>
      )}
    </div>
  );
}
