import { useState } from "react";
import { ChecklistRow, checklistSurface, DragHandle, TickBox } from "@/components/ui/Checklist";
import { LinkChip } from "@/components/ui/Chip";
import { PriceIcon } from "@/components/ui/icons";
import { Label, Panel, Section } from "./shared";

const rows = [
  { id: "glue", name: "Liquid glue for the build plate", shop: "bambulab.com", price: true },
  { id: "pla", name: "PLA Basic, black ×2", shop: null, price: true },
  { id: "nozzle", name: "Hardened steel nozzle, 0.4 mm", shop: "bambulab.com", price: false },
];

/** The shopping list's pieces: tick boxes, drag handles, link chips and the rows built from them. */
export function ChecklistSection() {
  const [ticked, setTicked] = useState<Record<string, boolean>>({ nozzle: false });
  return (
    <Section
      id="checklist"
      title="Checklist"
      note="A list to tick off and sort, such as the shopping list. A row is the tick box, the name (a button that opens it), a line of link chips, and the drag handle; rows sit on one soft surface with an inset hairline between them."
    >
      <div className="flex flex-col gap-6">
        <Panel className="flex flex-wrap items-center gap-6">
          <div className="flex flex-col items-center gap-1">
            <TickBox checked={false} onChange={() => undefined} label="Bought: an open box" />
            <Label>Open</Label>
          </div>
          <div className="flex flex-col items-center gap-1">
            <TickBox checked onChange={() => undefined} label="Bought: a ticked box" />
            <Label>Ticked</Label>
          </div>
          <div className="flex flex-col items-center gap-1">
            <TickBox checked={false} disabled onChange={() => undefined} label="Bought: offline" />
            <Label>Disabled</Label>
          </div>
          <div className="flex flex-col items-center gap-1">
            <DragHandle label="Move a row" onPointerDown={() => undefined} onMove={() => undefined} />
            <Label>Drag handle</Label>
          </div>
          <div className="flex flex-col items-start gap-1">
            <div className="flex gap-2">
              <LinkChip href="https://eu.store.bambulab.com/">bambulab.com</LinkChip>
              <LinkChip href="https://www.prisjakt.nu/" icon={PriceIcon}>
                Prisjakt
              </LinkChip>
            </div>
            <Label>Link chips</Label>
          </div>
        </Panel>
        <Panel className="max-w-content">
          <ul className={checklistSurface} aria-label="A shopping list">
            {rows.map((row, index) => {
              const done = !!ticked[row.id];
              return (
                <li key={row.id}>
                  <ChecklistRow
                    done={done}
                    lifted={row.id === "pla"}
                    last={index === rows.length - 1}
                    tick={
                      <TickBox
                        checked={done}
                        onChange={(next) => setTicked((current) => ({ ...current, [row.id]: next }))}
                        label={`Bought: ${row.name}`}
                      />
                    }
                    meta={
                      done ? (
                        <span className="text-small text-ink-faint">Sam got it just now</span>
                      ) : (
                        <>
                          {row.shop && <LinkChip href="https://eu.store.bambulab.com/">{row.shop}</LinkChip>}
                          {row.price && (
                            <LinkChip href="https://www.prisjakt.nu/" icon={PriceIcon}>
                              Prisjakt
                            </LinkChip>
                          )}
                        </>
                      )
                    }
                    handle={
                      <DragHandle label={`Move ${row.name}`} onPointerDown={() => undefined} onMove={() => undefined} />
                    }
                  >
                    <span
                      className={
                        done
                          ? "text-body text-ink-faint decoration-ink/30 line-through"
                          : "text-body text-ink font-semibold"
                      }
                    >
                      {row.name}
                    </span>
                  </ChecklistRow>
                </li>
              );
            })}
          </ul>
          <p className="text-small text-ink-faint mt-3">The second row is lifted, as it looks mid-drag.</p>
        </Panel>
      </div>
    </Section>
  );
}
