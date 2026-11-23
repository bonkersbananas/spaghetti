import type { Spool } from "@shared/api";
import { tempRange } from "@shared/label-read";
import { FINISHES, finishLabel, spoolColors } from "@shared/spools";
import { useQueryClient } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ToggleChip } from "@/components/ui/Chip";
import { SparkleIcon } from "@/components/ui/icons";
import { SpoolColourField, type SpoolColourValue } from "@/components/ui/SpoolColourField";
import { SpoolDisc } from "@/components/ui/SpoolDisc";
import { cn } from "@/lib/cn";
import { confirmLabelRead } from "@/lib/label-read";

/** What the label said besides colour, finish and weight: size, temperatures, drying, code. */
export function labelFactsLine(spool: Spool): string[] {
  const has = (field: (typeof spool.fromLabel)[number]) => spool.fromLabel.includes(field);
  return [
    has("diameterMm") && spool.diameterMm ? `${spool.diameterMm} mm` : null,
    has("nozzleTempMin") || has("nozzleTempMax")
      ? ((r) => (r ? `Nozzle ${r}` : null))(tempRange(spool.nozzleTempMin, spool.nozzleTempMax))
      : null,
    has("bedTempMin") || has("bedTempMax")
      ? ((r) => (r ? `Bed ${r}` : null))(tempRange(spool.bedTempMin, spool.bedTempMax))
      : null,
    has("dryTempC") && spool.dryTempC
      ? `Dry ${spool.dryTempC} °C${spool.dryHours ? `, ${spool.dryHours} h` : ""}`
      : null,
    has("productCode") && spool.productCode ? `Code ${spool.productCode}` : null,
  ].filter((part): part is string => !!part);
}

const weightText = (grams: number | null) =>
  grams === null ? "not read" : grams % 1000 === 0 ? `${grams / 1000} kg` : `${grams} g`;

interface LabelLooksRightProps {
  spool: Spool;
  /** The page's live colour and finish (what is typed, not yet saved included). */
  value: { colorHex: string | null; colors: string[] | null; finish: string | null };
  onChange: (changes: Partial<{ colorHex: string | null; colors: string[] | null; finish: string | null }>) => void;
  onSetWeight: () => void;
  readOnly: boolean;
  /** Opens the other fields (on a phone they are folded away). */
  onEditRest?: () => void;
  className?: string;
}

/**
 * After Claude has read a label: what people fix most (colour, finish, weight) right here, each changed in place,
 * the rest of what it read in one quiet line, and a quiet "Looks right". The card goes once nothing is left unconfirmed.
 */
export function LabelLooksRight({
  spool,
  value,
  onChange,
  onSetWeight,
  readOnly,
  onEditRest,
  className,
}: LabelLooksRightProps) {
  const queryClient = useQueryClient();
  const colours = spoolColors(value);
  const unread = colours.length === 0;
  const [pickingColour, setPickingColour] = useState(false);
  const [pickingFinish, setPickingFinish] = useState(false);
  if (spool.fromLabel.length === 0 || spool.labelRead) return null;
  const facts = labelFactsLine(spool);
  const row = "flex min-h-11 items-center gap-3 text-left";
  return (
    <section
      aria-label="What Claude read"
      className={cn("bg-cream shadow-soft flex flex-col gap-1 rounded-xl p-4 md:max-w-md", className)}
    >
      <p className="text-small text-ink-soft mb-1 flex items-center gap-2 font-semibold">
        <SparkleIcon size={16} weight="fill" aria-hidden className="shrink-0" />
        Claude read this
      </p>

      <fieldset disabled={readOnly} className="contents">
        <button
          type="button"
          className={cn(row, "focus-ring rounded-md")}
          aria-expanded={pickingColour || unread}
          onClick={() => setPickingColour((open) => !open)}
        >
          <SpoolDisc color={value.colorHex} colors={value.colors} size="sm" />
          <span className="text-body text-ink flex-1">{unread ? "Colour wasn't read" : "Colour"}</span>
          <span className="text-small text-ink-faint">{unread ? "Pick it" : "Change"}</span>
        </button>
        {(pickingColour || unread) && (
          <div className="pb-2">
            <SpoolColourField
              value={{ colorHex: value.colorHex, colors: value.colors }}
              onChange={(next: SpoolColourValue) => onChange(next)}
            />
          </div>
        )}

        <button
          type="button"
          className={cn(row, "focus-ring rounded-md")}
          aria-expanded={pickingFinish}
          onClick={() => setPickingFinish((open) => !open)}
        >
          <span className="text-body text-ink flex-1">Finish</span>
          <span className="text-body text-ink-soft">{value.finish ? finishLabel(value.finish) : "not read"}</span>
          <span className="text-small text-ink-faint">Change</span>
        </button>
        {pickingFinish && (
          <div className="flex flex-wrap gap-2 pb-2" role="group" aria-label="Finish">
            {FINISHES.map((finish) => (
              <ToggleChip
                key={finish}
                selected={value.finish === finish}
                onClick={() => onChange({ finish: value.finish === finish ? null : finish })}
              >
                {finishLabel(finish)}
              </ToggleChip>
            ))}
          </div>
        )}

        <button type="button" className={cn(row, "focus-ring rounded-md")} onClick={onSetWeight}>
          <span className="text-body text-ink flex-1">Net weight</span>
          <span className="text-body text-ink-soft">{weightText(spool.netGrams)}</span>
          <span className="text-small text-ink-faint">Change</span>
        </button>
      </fieldset>

      {facts.length > 0 && (
        <p className="text-small text-ink-soft mt-1 px-0.5">
          {facts.map((fact, index) => (
            <Fragment key={fact}>
              {index > 0 && (
                <span aria-hidden className="text-ink-faint">
                  {" · "}
                </span>
              )}
              <span className="whitespace-nowrap">{fact}</span>
            </Fragment>
          ))}
        </p>
      )}
      <div className="mt-2 flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={readOnly}
          onClick={() => void confirmLabelRead(queryClient, spool.id)}
        >
          Looks right
        </Button>
        {onEditRest && facts.length > 0 && (
          <Button variant="quiet" size="sm" disabled={readOnly} onClick={onEditRest}>
            Edit the rest
          </Button>
        )}
      </div>
    </section>
  );
}
