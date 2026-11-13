import {
  type Adaptation,
  AXES,
  type Axis,
  adaptedName,
  adaptMesh,
  boundsOf,
  describeAdaptation,
  fitScale,
  isUnchanged,
  type Mesh,
  parseStl,
  triangleCount,
  writeStl,
} from "@shared/mesh";
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { ToggleChip } from "@/components/ui/Chip";
import { TextField } from "@/components/ui/Field";
import { DownloadIcon, SlicerFileIcon, UndoIcon } from "@/components/ui/icons";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Sheet } from "@/components/ui/Sheet";
import { toast } from "@/components/ui/Toast";
import { MeshPreview } from "./MeshPreview";

/** What the sheet hands back when the adapted file is made: the changes, in the twist's words. */
export type AdaptedChange = ReturnType<typeof describeAdaptation>[number];

const mm = (n: number) => `${Number(n.toFixed(2))}`;
const size = (s: readonly [number, number, number]) => `${mm(s[0])} × ${mm(s[1])} × ${mm(s[2])} mm`;
/** "84", "84,5" or "84.5 %" as a number; NaN for anything else. */
const readNumber = (text: string) => Number(text.replace(",", ".").replace(/[%\s]/g, ""));

type FitAxis = Axis | "longest";

/**
 * Adapt an STL in the browser: scale it (or fit it to N mm), mirror it, turn it. The result is kept with the twist as
 * its model (decision 0053), named after the source and what changed ("fusilli-knob, 110 %.stl"), and sliced on the
 * page; it can also be downloaded, and opens in Bambu Studio like any STL. The original is never touched, and what was
 * done is added to the twist's changes. The mesh functions are pure (`shared/mesh.ts`); this sheet only asks for the
 * numbers.
 */
export default function AdaptSheet({
  open,
  onOpenChange,
  twistName,
  room,
  onAdapted,
  onKeep,
  keeping,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  twistName: string;
  /** How many more changes the twist can hold (it keeps at most 20). */
  room: number;
  onAdapted: (changes: AdaptedChange[]) => void;
  /** Keeps the adapted STL with the twist as its model; without it the sheet only downloads. */
  onKeep?: (file: File) => void;
  /** The twist keeps a model now: this one takes its place. */
  keeping?: string | null;
}) {
  const picker = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<{ name: string; mesh: Mesh } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [scale, setScale] = useState("100");
  const [fitTo, setFitTo] = useState("");
  const [fitAxis, setFitAxis] = useState<FitAxis>("longest");
  const [mirror, setMirror] = useState<Partial<Record<Axis, boolean>>>({});
  const [turns, setTurns] = useState<Partial<Record<Axis, number>>>({});

  async function choose(chosen: File | undefined) {
    if (!chosen) return;
    setProblem(null);
    const parsed = parseStl(await chosen.arrayBuffer());
    if (!parsed.ok) {
      setFile(null);
      return setProblem(parsed.reason);
    }
    setFile({ name: chosen.name.replace(/\.stl$/i, ""), mesh: parsed.mesh });
    setScale("100");
    setFitTo("");
    setMirror({});
    setTurns({});
  }

  const factor = readNumber(scale) / 100;
  const adaptation: Adaptation = { scale: Number.isFinite(factor) && factor > 0 ? factor : 1, mirror, turns };
  const validScale = Number.isFinite(factor) && factor > 0 && factor <= 100;
  const before = file ? boundsOf(file.mesh).size : null;
  const adapted = useMemo(
    () => (file && validScale ? adaptMesh(file.mesh, { scale: factor, mirror, turns }) : null),
    [file, validScale, factor, mirror, turns],
  );
  const after = adapted ? boundsOf(adapted).size : null;

  function fit() {
    if (!file) return;
    const target = readNumber(fitTo);
    // Fitting is about the model as it stands now: turned, then scaled.
    const turned = adaptMesh(file.mesh, { scale: 1, mirror: {}, turns });
    const found = fitScale(turned, target, fitAxis);
    if (found === null) return toast.message("Can't fit that", "Give a length in mm, on a side that has one.");
    setScale(String(Number((found * 100).toFixed(2))));
  }

  const turn = (axis: Axis) => setTurns((current) => ({ ...current, [axis]: ((current[axis] ?? 0) + 1) % 4 }));
  const reset = () => {
    setScale("100");
    setFitTo("");
    setMirror({});
    setTurns({});
  };

  /** Makes the adapted STL and adds what was done to the twist: kept with it, or downloaded. */
  function finish(how: "keep" | "download") {
    if (!file || !validScale || isUnchanged(adaptation)) return;
    const changes = describeAdaptation(adaptation);
    const named = adaptedName(file.name, adaptation);
    const bytes = writeStl(adaptMesh(file.mesh, adaptation), twistName || file.name);
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "model/stl" });
    if (how === "keep" && onKeep) onKeep(new File([blob], named, { type: "model/stl" }));
    else {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = named;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }
    const kept = changes.slice(0, Math.max(0, room));
    onAdapted(kept);
    const headline = how === "keep" ? "Kept with the twist" : "Adapted file made";
    if (kept.length === changes.length) {
      toast.success(headline, how === "keep" ? "It is being sliced." : "What we changed is in the twist.");
    } else {
      toast.message(
        headline,
        kept.length
          ? "Not all of what we changed fits in the twist: it keeps 20 changes."
          : "The twist already has 20 changes, so this isn't written in it.",
      );
    }
    setFile(null);
    onOpenChange(false);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        // A closed sheet forgets its file: the next one starts from choosing.
        if (!next) {
          setFile(null);
          setProblem(null);
        }
        onOpenChange(next);
      }}
      title="Adapt an STL"
      footer={
        file ? (
          <div className="flex flex-col gap-2">
            {onKeep && (
              <Button
                variant="primary"
                icon={SlicerFileIcon}
                className="w-full"
                disabled={!validScale || isUnchanged(adaptation)}
                onClick={() => finish("keep")}
              >
                Keep with the twist
              </Button>
            )}
            <div className="flex items-center gap-2">
              <Button
                variant={onKeep ? "secondary" : "primary"}
                icon={DownloadIcon}
                className="flex-1"
                disabled={!validScale || isUnchanged(adaptation)}
                onClick={() => finish("download")}
              >
                Download the STL
              </Button>
              <Button variant="quiet" icon={UndoIcon} onClick={reset} disabled={isUnchanged(adaptation)}>
                Reset
              </Button>
            </div>
            <p className="text-caption text-ink-faint text-center">
              {onKeep && keeping ? `Takes the place of ${keeping}` : "Made on this device"}
            </p>
          </div>
        ) : undefined
      }
      description="Scale it, mirror it, turn it. The twist keeps the new STL and slices it."
    >
      <div className="flex flex-col gap-6">
        <input
          ref={picker}
          type="file"
          accept=".stl,model/stl"
          hidden
          data-testid="adapt-file-input"
          onChange={(event) => {
            void choose(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        {!file ? (
          <div className="flex flex-col items-start gap-3">
            <Button variant="secondary" icon={SlicerFileIcon} onClick={() => picker.current?.click()}>
              Choose an STL file
            </Button>
            {problem && <p className="text-small text-tomato-ink font-medium">{problem}</p>}
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <p className="text-body text-ink font-semibold">{file.name}.stl</p>
              <p className="text-small text-ink-faint">
                {triangleCount(file.mesh).toLocaleString("en")} triangles · {before && size(before)}
              </p>
            </div>

            <div className="bg-lifted sticky top-0 z-10 -mx-1 flex flex-col gap-2 px-1 pb-2">
              <MeshPreview mesh={adapted ?? file.mesh} />
              <p className="text-body text-ink tabular text-center font-semibold">{after ? size(after) : "—"}</p>
            </div>

            <div className="flex flex-col gap-3">
              <TextField
                label="Scale"
                suffix="%"
                inputMode="decimal"
                value={scale}
                error={validScale ? undefined : "A number above 0 and up to 10 000, like 84."}
                onChange={(event) => setScale(event.target.value)}
              />
              <div className="flex flex-col gap-2">
                <SegmentedControl<FitAxis>
                  label="Fit a side to a length"
                  options={[
                    { value: "longest", label: "Longest" },
                    { value: "x", label: "X" },
                    { value: "y", label: "Y" },
                    { value: "z", label: "Z" },
                  ]}
                  value={fitAxis}
                  onChange={setFitAxis}
                />
                <div className="flex items-end gap-2">
                  <TextField
                    className="flex-1"
                    aria-label="Fit to length"
                    suffix="mm"
                    inputMode="decimal"
                    placeholder="42"
                    value={fitTo}
                    onChange={(event) => setFitTo(event.target.value)}
                  />
                  <Button variant="secondary" onClick={fit} disabled={!fitTo.trim()}>
                    Fit
                  </Button>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <p className="text-small text-ink-faint font-medium">Mirror</p>
              <div className="flex flex-wrap gap-2">
                {AXES.map((axis) => (
                  <ToggleChip
                    key={axis}
                    selected={!!mirror[axis]}
                    onClick={() => setMirror((current) => ({ ...current, [axis]: !current[axis] }))}
                  >
                    {axis.toUpperCase()}
                  </ToggleChip>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <p className="text-small text-ink-faint font-medium">Turn a quarter</p>
              <div className="flex flex-wrap gap-2">
                {AXES.map((axis) => (
                  <ToggleChip key={axis} selected={!!turns[axis]} onClick={() => turn(axis)}>
                    About {axis.toUpperCase()}
                    {turns[axis] ? ` · ${(turns[axis] ?? 0) * 90}°` : ""}
                  </ToggleChip>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}
