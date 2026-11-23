import type { Spool } from "@shared/api";
import { tempRange } from "@shared/label-read";
import { useQueryClient } from "@tanstack/react-query";
import { Fragment } from "react";
import { Button } from "@/components/ui/Button";
import { CheckIcon, SparkleIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { confirmLabelRead } from "@/lib/label-read";

/** What the label said that the page doesn't already put in its title: weight, size, temperatures, code. */
export function labelFactsLine(spool: Spool): string[] {
  const has = (field: (typeof spool.fromLabel)[number]) => spool.fromLabel.includes(field);
  const grams = spool.netGrams;
  return [
    has("netGrams") && grams ? (grams % 1000 === 0 ? `${grams / 1000} kg` : `${grams} g`) : null,
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

interface LabelLooksRightProps {
  spool: Spool;
  readOnly: boolean;
  /** Opens the fields (on a phone they are folded away) so any of it can be changed. */
  onEdit?: () => void;
  className?: string;
}

/**
 * After Claude has read a label: what it found, in one place, with one tap to say it is right. Anything wrong is
 * edited in the fields below (a touched field leaves the list); the card goes once nothing is left unconfirmed.
 */
export function LabelLooksRight({ spool, readOnly, onEdit, className }: LabelLooksRightProps) {
  const queryClient = useQueryClient();
  if (spool.fromLabel.length === 0 || spool.labelRead) return null;
  const facts = labelFactsLine(spool);
  return (
    <section
      aria-label="What Claude read"
      className={cn("bg-cream shadow-soft flex flex-col gap-3 rounded-xl p-4 md:max-w-md", className)}
    >
      <p className="text-small text-ink-soft flex items-center gap-2 font-semibold">
        <SparkleIcon size={16} weight="fill" aria-hidden className="shrink-0" />
        Claude read this
      </p>
      {facts.length > 0 && (
        <p className="text-body text-ink">
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
      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          icon={CheckIcon}
          disabled={readOnly}
          onClick={() => void confirmLabelRead(queryClient, spool.id)}
        >
          Looks right
        </Button>
        {onEdit && (
          <Button variant="quiet" size="sm" disabled={readOnly} onClick={onEdit}>
            Change something
          </Button>
        )}
      </div>
    </section>
  );
}
