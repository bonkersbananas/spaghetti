import type { AttemptFile } from "@shared/api";
import { qualityOf } from "@shared/slicing/settings.ts";
import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { SavedFileCard } from "@/components/builds/SlicerFile";
import { formatMinutes } from "@/components/builds/settings";
import { NextIcon, SlicerFileIcon } from "@/components/ui/icons";
import { MetaList } from "@/components/ui/MetaList";
import { Overline } from "@/components/ui/Overline";
import { removeItemFile } from "@/lib/item-files";

/**
 * The files kept with an idea (and its build): slicer files and models (sliced in the browser, ModelFile.tsx), each
 * with its plate picture, name, size and estimate, Download, the 3D view on a sliced one, and Remove (with Undo).
 * Loaded only once there is a file to show.
 */
export default function ItemFiles({
  itemId,
  files,
  readOnly,
  folded,
}: {
  itemId: string;
  files: AttemptFile[];
  readOnly?: boolean;
  /** A build with attempts: each file is one line (name, time, grams, quality) that opens its full card. */
  folded?: boolean;
}) {
  const queryClient = useQueryClient();
  if (!files.length) return null;
  return (
    <section aria-labelledby={`files-${itemId}`} className="my-1 flex flex-col gap-2">
      <Overline as="h2" id={`files-${itemId}`} count={files.length}>
        Files
      </Overline>
      <ul className="flex flex-col gap-2">
        {files.map((file) => (
          <li key={file.id}>
            <FileLine file={file} folded={folded}>
              <SavedFileCard
                raised
                file={file}
                owner={readOnly ? undefined : { itemId, attemptId: null }}
                onRemove={
                  readOnly || (file as { pending?: boolean }).pending
                    ? undefined
                    : () => removeItemFile(queryClient, itemId, file)
                }
              />
            </FileLine>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The one line a file folds to: "fusilli-hook · 36 min · 10.6 g · Standard". Tapping it opens the full card. */
function foldedPieces(file: AttemptFile): string[] {
  const slicing = file.slice?.settings;
  const quality = slicing ? qualityOf(slicing.layerHeight, slicing.slicing?.nozzle)?.label : undefined;
  return [
    file.name.replace(/(\.gcode)?\.(3mf|stl|obj|step)$/i, ""),
    file.prefill.estimatedMinutes !== undefined ? formatMinutes(file.prefill.estimatedMinutes) : "",
    file.prefill.weightGrams !== undefined
      ? `${file.prefill.weightGrams.toLocaleString("en", { maximumFractionDigits: 1 })} g`
      : "",
    quality ?? "",
  ].filter(Boolean);
}

function FileLine({ file, folded, children }: { file: AttemptFile; folded?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const settled =
    !(file as { pending?: boolean }).pending && (file.kind !== "model" || file.slice?.status === "sliced");
  if (!folded || open || !settled) return children;
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label={`Show file ${file.name}`}
      className="pressable focus-ring bg-ink/4 hover:bg-ink/6 text-small text-ink-soft flex min-h-11 w-full min-w-0 items-center gap-2.5 rounded-md py-1.5 pr-2.5 pl-3 text-left"
    >
      <SlicerFileIcon size={18} className="text-ink-faint shrink-0" aria-hidden />
      <MetaList className="min-w-0 flex-1">
        {foldedPieces(file).map((piece) => (
          <span key={piece} className="whitespace-nowrap">
            {piece}
          </span>
        ))}
      </MetaList>
      <NextIcon size={14} weight="bold" className="text-ink-ghost shrink-0" aria-hidden />
    </button>
  );
}
