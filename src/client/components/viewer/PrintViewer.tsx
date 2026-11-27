import type { Layer } from "@shared/gcode";
import { LIVE_FRESH_MS } from "@shared/print-progress";
import { mmWords, type Size, sizeSpoken } from "@shared/slicing/size";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { IconButton } from "@/components/ui/Button";
import { ToggleChip } from "@/components/ui/Chip";
import { PlayIcon } from "@/components/ui/icons";
import { Kbd } from "@/components/ui/Kbd";
import { LayerSlider } from "@/components/ui/LayerSlider";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { PulseDot } from "@/components/ui/PulseDot";
import { SegmentedControl, type SegmentedOption } from "@/components/ui/SegmentedControl";
import { Swatch } from "@/components/ui/Swatch";
import { cn } from "@/lib/cn";
import { printerQuery } from "@/lib/pantry-queries";
import { loadToolpaths, type ToolpathSummary } from "@/lib/toolpaths";
import { useNow } from "@/lib/use-now";
import { introSeen, markIntroSeen } from "./intro";
import { layerReadout, liveReadout } from "./readout";
import { type ColorBy, cssColor, legendFeatures, PrintScene } from "./scene";

export interface PrintViewerProps {
  /** Where the file is (`/api/files/<id>`). */
  url: string;
  /** Names the file for the "built up once" memory. */
  fileId: string;
  /** The plate whose G-code to read, in the file's own numbering: a model's slice has one plate, 1. */
  plate: number;
  /** The file is a model's slice that Spaghetti made, not one someone added. */
  ownSlice?: boolean;
  /** Said over the view while a new slice of it is under way (its toolpaths replace these when it is saved). */
  notice?: { text: string; fraction: number | null; percent?: boolean };
  /** How many copies of the plate's objects the slice has, and what one prints (kept with the slice), for the size shown. */
  copies?: number;
  size?: Size;
  /** The matched spools' colours, for filaments the file doesn't colour. */
  fallbackColors?: (string | null | undefined)[];
  /** Each filament's colour in the model itself, for a model whose colours were matched to spools: the switch to them. */
  originalColors?: (string | undefined)[];
  /** What each filament is called (the spool's name), for the legend, where the file says only "PLA". */
  names?: (string | undefined)[];
  /** Set while the attempt prints: the viewer follows the printer's own layer while the bridge reports it. */
  printing?: { id: string } | null;
  className?: string;
}

const MODES: readonly SegmentedOption<ColorBy>[] = [
  { value: "filament", label: "Filament" },
  { value: "feature", label: "Feature" },
];

const INTRO_MS = 2600;

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The 3D view of a sliced print: its toolpaths on a build plate, coloured by filament or by feature, with a layer
 * slider. The file is read in a Web Worker and the layers appear as they arrive. On the first open of a file the print
 * builds itself up, layer by layer (never with reduced motion). One finger turns it, two pinch and pan; on desktop
 * drag, scroll, and the arrow keys step layers.
 */
export default function PrintViewer({
  url,
  fileId,
  plate,
  ownSlice,
  notice,
  copies,
  size,
  fallbackColors,
  originalColors,
  names,
  printing,
  className,
}: PrintViewerProps) {
  // The printer's own layer while the bridge reports it for this attempt and the report is fresh; nothing otherwise.
  const now = useNow();
  const report = useQuery({ ...printerQuery, enabled: !!printing }).data?.bridge?.progress;
  const live =
    printing && report?.attemptId === printing.id && now - report.at <= LIVE_FRESH_MS && report.layer
      ? { layer: report.layer, totalLayers: report.totalLayers, remainingMinutes: report.remainingMinutes }
      : null;
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const scene = useRef<PrintScene | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const [count, setCount] = useState(0);
  const [layer, setLayerState] = useState(0);
  const [mode, setMode] = useState<ColorBy>("filament");
  // The spools the print uses, or the model's own colours (a model whose colours were matched to spools).
  const [palette, setPalette] = useState<"matched" | "original">("matched");
  const [summary, setSummary] = useState<ToolpathSummary | null>(null);
  const [features, setFeatures] = useState<number[]>([]);
  const [replays, setReplays] = useState(0);
  // True from the moment the print is read until its build-up has run (or was never going to).
  const [building, setBuilding] = useState(false);
  const heights = useRef<number[]>([]);
  const times = useRef<(number | null)[]>([]);
  const used = useRef(new Set<number>());
  const follow = useRef(true);
  const animation = useRef(0);
  const live0 = live ? live.layer - 1 : null;
  // A print in progress shows where it is at once; the build-up is for finished prints.
  const liveNow = useRef<number | null>(null);
  liveNow.current = live0;
  // Where the view rests when nobody moved it: the layer being printed, else the last. `follow` stays true while it is
  // there, so the view keeps up as layers arrive and as the print goes on.
  const restOf = useCallback((total: number) => Math.max(0, Math.min(liveNow.current ?? total - 1, total - 1)), []);

  const setLayer = useCallback((index: number) => {
    scene.current?.setLayer(index);
    setLayerState(index);
  }, []);

  // The scene, and the file.
  // biome-ignore lint/correctness/useExhaustiveDependencies: fallbackColors is read once, at the start
  useEffect(() => {
    const element = canvas.current;
    const box = stage.current;
    if (!element || !box) return;
    let ps: PrintScene;
    try {
      ps = new PrintScene(element);
    } catch {
      setError("This browser can't draw 3D here.");
      setState("error");
      return;
    }
    scene.current = ps;
    ps.setLive(liveNow.current !== null);
    const colors = () =>
      ps.setTheme({
        plate: cssColor("--sg-plate"),
        plateEdge: cssColor("--sg-plate-edge"),
        plateGrid: cssColor("--sg-plate-grid"),
        light: cssColor("--sg-studio-light"),
        sky: cssColor("--sg-studio-sky"),
        ground: cssColor("--sg-studio-ground"),
        ink: cssColor("--sg-ink"),
      });
    colors();
    const theme = new MutationObserver(colors);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const resize = new ResizeObserver(([entry]) => {
      if (entry) ps.resize(entry.contentRect.width, entry.contentRect.height);
    });
    resize.observe(box);

    const onLayers = (layers: Layer[]) => {
      for (const l of layers) {
        heights.current[l.index] = l.z;
        times.current[l.index] = l.seconds;
        for (const f of l.feature) used.current.add(f);
      }
      ps.addLayers(layers);
      const total = ps.layerCount;
      setCount(total);
      if (follow.current) {
        ps.setLayer(restOf(total));
        setLayerState(restOf(total));
      }
    };
    const stop = loadToolpaths(
      { url, plate, copies, ownSlice, fallbackColors: fallbackColors?.map((c) => c ?? null) },
      {
        onLayers,
        onProgress: setProgress,
        onError: (message) => {
          setError(message);
          setState("error");
        },
        onDone: (paths) => {
          setSummary(paths);
          ps.setFilaments(paths.filaments.map((f) => f.color));
          setFeatures([...used.current]);
          setState("ready");
          setProgress(1);
          ps.fit();
          if (!prefersReducedMotion() && !introSeen(fileId) && liveNow.current === null) {
            markIntroSeen(fileId);
            setBuilding(true);
            setReplays((n) => n + 1);
          }
        },
      },
    );
    return () => {
      stop();
      theme.disconnect();
      resize.disconnect();
      cancelAnimationFrame(animation.current);
      ps.dispose();
      scene.current = null;
    };
    // The file is what the viewer is for: a different one is a different viewer.
  }, [url, plate, fileId]);

  useEffect(() => {
    scene.current?.setMode(mode);
  }, [mode]);

  const isLive = live0 !== null && live0 >= 0;
  useEffect(() => {
    scene.current?.setLive(isLive);
  }, [isLive]);

  // The print goes on (or ends) while the view is open: the view goes with it unless someone moved it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: live0 is read through restOf's ref; a change is what moves it
  useEffect(() => {
    if (!follow.current || building || count < 1) return;
    setLayer(restOf(count));
  }, [live0, count, building, setLayer, restOf]);

  // The build-up: the slider runs from the first layer to the last, easing in and out; a touch on the slider stops it.
  useEffect(() => {
    if (!replays || state !== "ready" || count < 2) return;
    follow.current = false;
    const start = performance.now();
    const last = count - 1;
    // Resuming after a pause carries on from the layer reached, in proportion of the time.
    const from = Math.min(resumeFrom.current, last);
    resumeFrom.current = 0;
    const duration = Math.max(400, INTRO_MS * ((last - from) / last));
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      setLayer(Math.round(from + eased * (last - from)));
      if (t < 1) animation.current = requestAnimationFrame(tick);
      else {
        follow.current = last === restOf(count);
        setBuilding(false);
      }
    };
    setLayer(from);
    animation.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animation.current);
  }, [replays, state, count, setLayer, restOf]);

  const resumeFrom = useRef(0);
  const replay = (from = 0) => {
    if (prefersReducedMotion()) return;
    resumeFrom.current = from;
    setBuilding(true);
    setReplays((n) => n + 1);
  };

  // Pause where it is: the slider stays on the layer it reached.
  const pause = () => {
    cancelAnimationFrame(animation.current);
    setBuilding(false);
    follow.current = layer === restOf(count);
  };

  const scrub = (index: number) => {
    cancelAnimationFrame(animation.current);
    setBuilding(false);
    follow.current = index === restOf(count);
    setLayer(index);
  };

  // Back to the layer being printed, and following it again. Focus goes to the stage, as the chip leaves.
  const backToNow = () => {
    scrub(restOf(count));
    stage.current?.focus({ preventScroll: true });
  };

  // The keys belong to the viewer for as long as it is open, wherever focus is: the sheet's close button, the canvas after a drag, the slider.
  // Text fields keep their keys, and so do the Filament/Feature radios (their arrows choose a colouring, as a radio group does).
  const keys = useRef<(event: KeyboardEvent) => void>(() => {});
  keys.current = (event) => {
    if (event.defaultPrevented || event.altKey || event.metaKey || event.ctrlKey || count < 1) return;
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName;
    const type = (target as HTMLInputElement | null)?.type;
    if (target?.closest("[data-own-arrows]")) return;
    if (tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;
    if (tag === "INPUT" && type !== "range") return;
    const step = event.shiftKey ? 10 : 1;
    const key = event.key;
    if (key === " ") {
      // Space activates a focused button, link or radio, as it does everywhere.
      if (target?.closest("button, a, summary, [role=button], [role=radio], [role=tab], [role=menuitem]")) return;
      event.preventDefault();
      if (!event.repeat && count > 1) {
        if (building) pause();
        else replay(layer < count - 1 ? layer : 0);
      }
      return;
    }
    let next: number | null = null;
    if (key === "ArrowRight" || key === "ArrowUp") next = layer + step;
    else if (key === "ArrowLeft" || key === "ArrowDown") next = layer - step;
    else if (key === "Home") next = 0;
    else if (key === "End") next = count - 1;
    else if ((key === "n" || key === "N") && !event.shiftKey && liveNow.current !== null) {
      event.preventDefault();
      if (!event.repeat) backToNow();
      return;
    }
    if (next === null) return;
    event.preventDefault();
    scrub(Math.min(count - 1, Math.max(0, next)));
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => keys.current(event);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The viewer mounts after the sheet opened (its code loads lazily), when focus has gone to the sheet itself, its Close
  // button or the opener: it belongs on the stage, so Space plays. Anything else that took focus keeps it.
  useEffect(() => {
    const active = document.activeElement;
    if (
      !active ||
      active === document.body ||
      active.closest("button, a, [data-autofocus]") ||
      active.matches("[role=dialog]")
    )
      stage.current?.focus({ preventScroll: true });
  }, []);

  // What one copy prints: kept with the slice, else read from the file's own model (older slices, dropped files).
  const shownSize = size ?? summary?.size ?? undefined;
  const text = layerReadout(layer, count || 1, heights.current[layer], times.current[layer]);
  // At the layer being printed, the view says where the print is; moved away, which layer it shows and the way back.
  const atNow = live !== null && follow.current && !building;
  const away = live !== null && !atNow && state === "ready";
  const lastTime = times.current[count - 1];
  const nowTime = live0 !== null ? times.current[live0] : null;
  const nowText = live
    ? liveReadout(
        live.layer,
        live.totalLayers || count,
        live.remainingMinutes,
        lastTime != null && nowTime != null ? Math.max(0, lastTime - nowTime) : null,
      )
    : "";
  const shown = atNow ? nowText : text;
  const printed = summary?.filaments ?? [];
  const filaments =
    palette === "original" && originalColors
      ? printed.map((f, i) => ({ ...f, color: originalColors[i] ?? f.color }))
      : printed;
  // The scene follows the switch (and the file's colours once it is read).
  useEffect(() => {
    if (!summary) return;
    const own = palette === "original" ? originalColors : undefined;
    scene.current?.setFilaments(summary.filaments.map((f, i) => own?.[i] ?? f.color));
  }, [summary, palette, originalColors]);
  const showFilaments = mode === "filament" && filaments.filter((f) => f.segments > 0).length > 1;

  return (
    <div
      className={cn("flex h-full min-h-0 flex-col", className)}
      data-viewer={state === "ready" && !building ? "ready" : state === "error" ? "error" : "busy"}
    >
      <div
        ref={stage}
        className="sg-stage group relative min-h-0 flex-1 overflow-hidden outline-none"
        data-vaul-no-drag
        // Where focus lands when the view opens (the sheet looks for data-autofocus): not the close button, so Space plays.
        data-autofocus
        tabIndex={-1}
      >
        <canvas
          ref={canvas}
          className="absolute inset-0 block size-full"
          role="img"
          aria-label={state === "ready" ? `3D view of the print. ${shown}` : "3D view of the print"}
        />
        {/* The stage's keyboard focus ring, drawn over the canvas (an inset shadow on the stage would sit under it). */}
        <div
          aria-hidden
          className="group-focus-visible:ring-ink/20 pointer-events-none absolute inset-0 group-focus-visible:ring-2 group-focus-visible:ring-inset"
        />
        {(state === "loading" || notice) && (
          <div className="pointer-events-none absolute bottom-3 left-3 flex flex-col items-start gap-2 pr-14">
            {notice && (
              <div className="bg-cream/90 shadow-soft text-small text-ink flex items-center gap-2 rounded-full py-1.5 pr-3.5 pl-3">
                <ProgressRing value={notice.fraction} className="size-4" />
                {/* The words are read out as they change; the percent only shows. */}
                <span role="status">{notice.text}</span>
                {notice.percent && notice.fraction !== null && (
                  <span aria-hidden className="tabular text-ink-soft -ml-1">
                    {Math.round(notice.fraction * 100)}%
                  </span>
                )}
              </div>
            )}
            {state === "loading" && (
              <div className="bg-cream/90 shadow-soft text-small text-ink-soft flex items-center gap-2 rounded-full py-1.5 pr-3.5 pl-3">
                <ProgressRing value={progress > 0 ? progress : null} className="size-4" />
                <span className="tabular">
                  {progress > 0 ? `Reading the file… ${Math.round(progress * 100)}%` : "Opening the file…"}
                </span>
              </div>
            )}
          </div>
        )}
        {state === "error" && (
          <div className="absolute inset-0 flex items-center justify-center p-8 text-center">
            <p className="text-body text-ink-soft max-w-xs">{error || "Couldn't read this file."}</p>
          </div>
        )}
        {state === "ready" && (
          // biome-ignore lint/a11y/useSemanticElements: a row of chips, not a form fieldset
          <div
            role="group"
            aria-label="What the colours mean"
            // biome-ignore lint/a11y/noNoninteractiveTabindex: a row that scrolls sideways on a phone must be reachable by keyboard
            tabIndex={0}
            data-own-arrows
            className="no-scrollbar focus-ring sg-fade-x absolute inset-x-0 top-3 flex gap-1.5 overflow-x-auto px-3 md:flex-wrap md:overflow-visible"
          >
            {showFilaments &&
              filaments.map((f, i) =>
                f.segments > 0 ? (
                  <LegendChip
                    // biome-ignore lint/suspicious/noArrayIndexKey: filaments have no id; the list never reorders
                    key={`f${i}`}
                    color={f.color ?? undefined}
                    label={names?.[i] ?? filamentLabel(f.type, i, filaments.length)}
                  />
                ) : null,
              )}
            {mode === "feature" &&
              legendFeatures(new Set(features)).map((f) => <LegendChip key={f.id} color={f.color} label={f.name} />)}
          </div>
        )}
        {state === "ready" && count > 1 && (
          // Thumb-sized on a phone (44 px, its middle level with the colours control beside it), 36 px for a mouse.
          <IconButton
            icon={PlayIcon}
            label="Build it up again"
            variant="stage"
            className="absolute right-3 bottom-3"
            onClick={() => replay()}
          />
        )}
        {state === "ready" && originalColors && mode === "filament" && (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
            <SegmentedControl
              label="Colours shown"
              labelHidden
              overlay
              className="pointer-events-auto"
              options={[
                { value: "matched", label: "In our filaments" },
                { value: "original", label: "Model's colours" },
              ]}
              value={palette}
              onChange={setPalette}
            />
          </div>
        )}
        {state === "ready" && summary?.stats.decimated && (
          <p
            className={cn(
              "bg-cream/90 text-caption text-ink-faint absolute left-3 rounded-full px-2.5 py-1",
              originalColors && mode === "filament" ? "bottom-16" : "bottom-3",
            )}
          >
            Simplified to fit this device
          </p>
        )}
      </div>
      <div className="bg-lifted shrink-0 px-5 pt-3 pb-[max(1rem,var(--sg-safe-bottom))] md:px-6 md:pb-4">
        <div className="mx-auto flex w-full max-w-2xl flex-wrap items-center gap-x-3">
          <div
            className={cn(
              "order-1 flex w-full min-w-0 items-center gap-2 md:w-auto md:flex-1",
              live && "min-h-9 md:min-h-8",
            )}
          >
            {atNow && <PulseDot size="sm" />}
            <p className="text-small text-ink-faint tabular min-w-0 flex-1 truncate md:flex-none" data-readout>
              {state === "ready" || count > 0 ? (
                <>
                  {atNow && <span className="sr-only">Printing now. </span>}
                  {shown.split(" · ").map((part, i) => (
                    <span
                      // biome-ignore lint/suspicious/noArrayIndexKey: the parts of one line, always in this order
                      key={i}
                      // Beside "Back to now" on a phone the height gives way, so the layer and its time fit.
                      className={cn(i === 0 && "text-ink font-semibold", i === 1 && away && "max-md:hidden")}
                    >
                      {i > 0 ? " · " : ""}
                      {part}
                    </span>
                  ))}
                </>
              ) : (
                "\u00a0"
              )}
            </p>
            {away && (
              <ToggleChip lead onClick={backToNow} className="shrink-0">
                <span aria-hidden className="bg-semolina ml-1 size-2 rounded-full" />
                Back to now
              </ToggleChip>
            )}
          </div>
          {shownSize && (
            <p
              className="text-small text-ink-faint tabular order-1 w-full min-w-0 truncate md:w-auto md:shrink-0"
              data-size
            >
              <span className="sr-only">{`${sizeSpoken(shownSize)}${copies && copies > 1 ? ", each copy" : ""}`}</span>
              <span aria-hidden>
                <SizeAxis letter="W" mm={shownSize[0]} />
                <SizeAxis letter="D" mm={shownSize[1]} />
                <SizeAxis letter="H" mm={shownSize[2]} last />
                {" mm"}
                {copies && copies > 1 ? " each" : ""}
              </span>
            </p>
          )}
          <SegmentedControl
            label="Colour by"
            labelHidden
            options={MODES}
            value={mode}
            onChange={setMode}
            className="order-3 mt-1 w-full md:order-2 md:mt-0 md:w-52"
          />
          <LayerSlider
            label="Layer"
            value={Math.min(layer, Math.max(0, count - 1))}
            max={Math.max(0, count - 1)}
            onChange={scrub}
            valueText={shown}
            live={live0}
            liveLabel="now"
            className="order-2 w-full md:order-3"
          />
          <p className="text-caption text-ink-faint order-4 mt-1 hidden w-full items-center justify-center gap-1.5 md:flex">
            <Kbd keys={["←"]} />
            <Kbd keys={["→"]} />
            step layers
            <Kbd keys={["Shift"]} className="ml-2" />
            ten at a time
            <Kbd keys={["Space"]} className="ml-2" />
            play or pause
            {live && (
              <>
                <Kbd keys={["N"]} className="ml-2" />
                back to now
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

/** "W 29.96 ·": an axis's letter, faint, and its length in the ink colour. */
function SizeAxis({ letter, mm, last }: { letter: string; mm: number; last?: boolean }) {
  return (
    <>
      {letter} <span className="text-ink font-semibold">{mmWords(mm)}</span>
      {last ? "" : " · "}
    </>
  );
}

/** "PLA" when one filament is PLA, "PLA 2" when several are. */
function filamentLabel(type: string | undefined, index: number, count: number): string {
  return type ? (count > 1 ? `${type} ${index + 1}` : type) : `Filament ${index + 1}`;
}

function LegendChip({ color, label }: { color?: string; label: string }) {
  return (
    <span className="bg-cream/90 shadow-soft text-caption text-ink-soft flex shrink-0 items-center gap-1.5 rounded-full py-1 pr-2.5 pl-2 font-medium whitespace-nowrap">
      <Swatch color={color} />
      {label}
    </span>
  );
}
