import { formatKr } from "@shared/prisjakt";
import { useState } from "react";
import { AskLine, AskName } from "@/components/ui/AskLine";
import { Button } from "@/components/ui/Button";
import { ChecklistName, ChecklistRow, checklistSurface, TickBox } from "@/components/ui/Checklist";
import { DragHandle } from "@/components/ui/DragHandle";
import { PriceIcon } from "@/components/ui/icons";
import { LinkChip } from "@/components/ui/LinkChip";
import { OfferRow, PriceLine } from "@/components/ui/Prices";
import { MatchRow, SuggestionCard } from "@/components/ui/Suggestion";
import { Thumb } from "@/components/ui/Thumb";
import { Label, Panel, Section } from "./shared";

const rows = [
  { id: "glue", name: "Liquid glue for the build plate", price: 149, picture: true },
  { id: "pla", name: "PLA Basic, black ×2", price: null, picture: false },
  {
    id: "caliper",
    name: "Digital caliper, 150 mm, stainless steel with LCD display and depth rod",
    price: null,
    picture: false,
  },
  { id: "nozzle", name: "Hardened steel nozzle, 0.4 mm", price: 249, picture: true },
];

/** The shopping list's pieces: tick boxes, drag handles, link chips and the rows built from them. */
export function ChecklistSection() {
  const [ticked, setTicked] = useState<Record<string, boolean>>({ nozzle: false });
  return (
    <Section
      id="checklist"
      title="Checklist"
      note="A list to tick off and sort, such as the shopping list. A row is one line: the tick box, a picture only when the thing has one (never an empty tile), the name (a button that opens it, cut with an ellipsis), something quiet at the end (the cheapest price found, when it was bought) and the drag handle; rows sit on one soft surface with an inset hairline between them. Pages to confirm are one offer for the whole list, not a chip on every row. Prices are always found at a time (“checked today”), never a promise; a suggested page is never used until someone taps Use it."
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
            <DragHandle size="line" label="Move a row" onPointerDown={() => undefined} onMove={() => undefined} />
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
        <Panel className="max-w-content flex flex-col gap-6">
          <div className="flex flex-col gap-1">
            <Label>Thumb, price line and offers</Label>
            <div className="flex items-start gap-3">
              <Thumb src="/icon-192.png" alt="" />
              <div className="flex flex-col gap-1">
                <span className="text-body text-ink font-semibold">PLA Basic, black ×2</span>
                <PriceLine price={189} shop="Kjell" checkedAt={Date.now()} />
              </div>
            </div>
            <ul aria-label="Cheapest offers" className="mt-2 flex flex-col">
              <li>
                <OfferRow offer={{ shop: "Kjell", price: 189, inStock: true }} href="https://www.prisjakt.nu/" first />
              </li>
              <li>
                <OfferRow offer={{ shop: "Webhallen", price: 205, inStock: true }} href="https://www.prisjakt.nu/" />
              </li>
              <li>
                <OfferRow offer={{ shop: "Inet", price: 179, inStock: false }} href="https://www.prisjakt.nu/" />
              </li>
            </ul>
          </div>
          <div className="flex flex-col gap-1">
            <Label>Suggestion</Label>
            <SuggestionCard
              title="Bambu Lab PLA Basic Filament 1.75 mm 1 kg, Black"
              href="https://www.prisjakt.nu/"
              onUse={() => undefined}
              onDismiss={() => undefined}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Match prices: one offer for the list</Label>
            <AskLine
              icon={PriceIcon}
              detail="Claude found their Prisjakt pages to check."
              actions={
                <Button variant="secondary" size="sm">
                  Match prices
                </Button>
              }
            >
              <AskName>8 things</AskName> could show their prices
            </AskLine>
          </div>
          <div className="flex flex-col gap-1">
            <Label>Match rows, in the Match prices sheet</Label>
            <ul className="divide-hairline flex flex-col divide-y">
              <li>
                <MatchRow
                  name="Silica gel for the dry box"
                  title="Silica gel, 1 kg, orange indicating"
                  href="https://www.prisjakt.nu/"
                  onUse={() => undefined}
                  onDismiss={() => undefined}
                />
              </li>
              <li>
                <MatchRow
                  name="PTFE tube, 1 m"
                  title="Bambu Lab PTFE tube 1 m"
                  href="https://www.prisjakt.nu/"
                  answer="used"
                  onUse={() => undefined}
                  onDismiss={() => undefined}
                />
              </li>
            </ul>
          </div>
          <ul className={checklistSurface} aria-label="A shopping list">
            {rows.map((row, index) => {
              const done = !!ticked[row.id];
              return (
                <li key={row.id}>
                  <ChecklistRow
                    done={done}
                    lifted={row.id === "pla"}
                    last={index === rows.length - 1}
                    thumb={row.picture ? <Thumb src="/icon-192.png" alt="" faded={done} /> : undefined}
                    pictureRoom
                    tick={
                      <TickBox
                        checked={done}
                        onChange={(next) => setTicked((current) => ({ ...current, [row.id]: next }))}
                        label={`Bought: ${row.name}`}
                      />
                    }
                    aside={
                      done ? (
                        "just now"
                      ) : row.price ? (
                        <span className="text-ink-soft tabular-nums">{formatKr(row.price)}</span>
                      ) : undefined
                    }
                    handle={
                      <DragHandle
                        size="line"
                        label={`Move ${row.name}`}
                        onPointerDown={() => undefined}
                        onMove={() => undefined}
                      />
                    }
                  >
                    <ChecklistName done={done} onOpen={() => undefined}>
                      {row.name}
                    </ChecklistName>
                  </ChecklistRow>
                </li>
              );
            })}
          </ul>
          <p className="text-small text-ink-faint mt-3">
            The second row is lifted, as it looks mid-drag; the third has a name too long for its line.
          </p>
        </Panel>
      </div>
    </Section>
  );
}
