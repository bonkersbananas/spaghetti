import type { Layer } from "@shared/gcode";
import { formatDuration } from "@shared/time";
import { useCallback, useEffect, useRef, useState } from "react";
import { IconButton } from "@/components/ui/Button";
import { PlayIcon } from "@/components/ui/icons";
import { Kbd } from "@/components/ui/Kbd";
import { LayerSlider } from "@/components/ui/LayerSlider";
import { ProgressRing } from "@/components/ui/ProgressRing";
import { SegmentedControl, type SegmentedOption } from "@/components/ui/SegmentedControl";
import { Swatch } from "@/components/ui/Swatch";
import { cn } from "@/lib/cn";
import { loadToolpaths, type ToolpathSummary } from "@/lib/toolpaths";
import { introSeen, markIntroSeen } from "./intro";
import { type ColorBy, cssColor, legendFeatures, PrintScene } from "./scene";

export interface PrintViewerProps {
  /** Where the file is (`/api/files/<id>`). */
  url: string;
  /** Names the file for the "built up once" memory. */
  fileId: string;
  plate: number;
  /** The matched spools' colours, for filaments the file doesn't colour. */
  fallbackColors?: (string | null | undefined)[];
  /** A print in progress: the layer it is on (counting from 1) and how many there are. */
  live?: { layer: number; totalLayers: number | null } | null;
  className?: string;
}

const MODES: readonly SegmentedOption<ColorBy>[] = [
  { value: "filament", label: "Filament" },
  { value: "feature", label: "Feature" },
];

const INTRO_MS = 2600;

/** The slider's readout for a layer: "Layer 112 of 240 · 13.4 mm · 1 h 12 min in". */
export function layerReadout(index: number, count: number, z: number | undefined, seconds: number | null | undefined) {
  const parts = [`Layer ${index + 1} of ${count}`];
  if (z !== undefined) parts.push(`${(Math.round(z * 100) / 100).toString()} mm`);
  if (seconds != null) parts.push(seconds < 60 ? "at the start" : `${formatDuration(seconds / 60)} in`);
  return parts.join(" · ");
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The 3D view of a sliced print: its toolpaths on a build plate, coloured by filament or by feature, with a layer
 * slider. The file is read in a Web Worker and the layers appear as they arrive. On the first open of a file the print
 * builds itself up, layer by layer (never with reduced motion). One finger turns it, two pinch and pan; on desktop
 * drag, scroll, and the arrow keys step layers.
 */
export default function PrintViewer({ url, fileId, plate, fallbackColors, live, className }: PrintViewerProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const scene = useRef<PrintScene | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);
  const [count, setCount] = useState(0);
  const [layer, setLayerState] = useState(0);
  const [mode, setMode] = useState<ColorBy>("filament");
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
  const liveNow = useRef(false);
  liveNow.current = live0 !== null;

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
    const colors = () =>
      ps.setTheme({
        plate: cssColor("--sg-plate"),
        plateEdge: cssColor("--sg-plate-edge"),
        light: cssColor("--sg-studio-light"),
        sky: cssColor("--sg-studio-sky"),
        ground: cssColor("--sg-studio-ground"),
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
        ps.setLayer(total - 1);
        setLayerState(total - 1);
      }
    };
    const stop = loadToolpaths(
      { url, plate, fallbackColors: fallbackColors?.map((c) => c ?? null) },
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
          if (!prefersReducedMotion() && !introSeen(fileId) && !liveNow.current) {
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

  useEffect(() => {
    scene.current?.setLive(live0 !== null && live0 >= 0 ? live0 : null);
  }, [live0]);

  // The build-up: the slider runs from the first layer to the last, easing in and out; a touch on the slider stops it.
  useEffect(() => {
    if (!replays || state !== "ready" || count < 2) return;
    follow.current = false;
    const start = performance.now();
    const last = count - 1;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / INTRO_MS);
      const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      setLayer(Math.round(eased * last));
      if (t < 1) animation.current = requestAnimationFrame(tick);
      else {
        follow.current = true;
        setBuilding(false);
      }
    };
    setLayer(0);
    animation.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animation.current);
  }, [replays, state, count, setLayer]);

  const scrub = (index: number) => {
    cancelAnimationFrame(animation.current);
    setBuilding(false);
    follow.current = index >= count - 1;
    setLayer(index);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if ((event.target as HTMLElement).tagName === "INPUT" || event.altKey || event.metaKey || event.ctrlKey) return;
    const step = event.shiftKey ? 10 : 1;
    const key = event.key;
    let next: number | null = null;
    if (key === "ArrowRight" || key === "ArrowUp") next = layer + step;
    else if (key === "ArrowLeft" || key === "ArrowDown") next = layer - step;
    else if (key === "Home") next = 0;
    else if (key === "End") next = count - 1;
    if (next === null) return;
    event.preventDefault();
    scrub(Math.min(count - 1, Math.max(0, next)));
  };

  const text = layerReadout(layer, count || 1, heights.current[layer], times.current[layer]);
  const filaments = summary?.filaments ?? [];
  const showFilaments = mode === "filament" && filaments.filter((f) => f.segments > 0).length > 1;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: arrow keys step layers wherever focus is inside the viewer
    <div
      className={cn("flex h-full min-h-0 flex-col", className)}
      onKeyDown={onKeyDown}
      data-viewer={state === "ready" && !building ? "ready" : state === "error" ? "error" : "busy"}
    >
      <div ref={stage} className="sg-stage relative min-h-0 flex-1 overflow-hidden" data-vaul-no-drag>
        <canvas
          ref={canvas}
          className="absolute inset-0 block size-full"
          role="img"
          aria-label={state === "ready" ? `3D view of the print. ${text}` : "3D view of the print"}
        />
        {state === "loading" && (
          <div className="bg-cream/90 shadow-soft text-small text-ink-soft absolute bottom-3 left-3 flex items-center gap-2 rounded-full py-1.5 pr-3.5 pl-3">
            <ProgressRing value={progress > 0 ? progress : null} className="size-4" />
            <span className="tabular">
              {progress > 0 ? `Reading the file… ${Math.round(progress * 100)}%` : "Opening the file…"}
            </span>
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
            className="no-scrollbar focus-ring sg-fade-x absolute inset-x-0 top-3 flex gap-1.5 overflow-x-auto px-3 md:flex-wrap md:overflow-visible"
          >
            {showFilaments &&
              filaments.map((f, i) =>
                f.segments > 0 ? (
                  <LegendChip
                    // biome-ignore lint/suspicious/noArrayIndexKey: filaments have no id; the list never reorders
                    key={`f${i}`}
                    color={f.color ?? undefined}
                    label={filamentLabel(f.type, i, filaments.length)}
                  />
                ) : null,
              )}
            {mode === "feature" &&
              legendFeatures(new Set(features)).map((f) => <LegendChip key={f.id} color={f.color} label={f.name} />)}
          </div>
        )}
        {state === "ready" && count > 1 && (
          <IconButton
            icon={PlayIcon}
            label="Build it up again"
            size="sm"
            className="bg-cream/90 shadow-soft absolute right-3 bottom-3"
            onClick={() => {
              if (prefersReducedMotion()) return;
              setBuilding(true);
              setReplays((n) => n + 1);
            }}
          />
        )}
        {state === "ready" && summary?.stats.decimated && (
          <p className="bg-cream/90 text-caption text-ink-faint absolute bottom-3 left-3 rounded-full px-2.5 py-1">
            Simplified to fit this device
          </p>
        )}
      </div>
      <div className="bg-lifted shrink-0 px-5 pt-3 pb-[max(1rem,var(--sg-safe-bottom))] md:px-6 md:pb-4">
        <div className="mx-auto flex w-full max-w-2xl flex-wrap items-center gap-x-3">
          <p className="text-small text-ink-faint tabular order-1 w-full min-w-0 truncate md:w-auto md:flex-1">
            {state === "ready" || count > 0 ? (
              <>
                <span className="text-ink font-semibold">{text.split(" · ")[0]}</span>
                {text.slice(text.split(" · ")[0]?.length ?? 0)}
              </>
            ) : (
              "\u00a0"
            )}
          </p>
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
            valueText={text}
            live={live0}
            className="order-2 w-full md:order-3"
          />
          <p className="text-caption text-ink-faint order-4 mt-1 hidden w-full items-center justify-center gap-1.5 md:flex">
            <Kbd keys={["←"]} />
            <Kbd keys={["→"]} />
            step layers
            <Kbd keys={["Shift"]} className="ml-2" />
            ten at a time
          </p>
        </div>
      </div>
    </div>
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
