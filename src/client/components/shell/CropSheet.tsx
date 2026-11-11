import { type CropView, clampView, MAX_ZOOM, panView, startView, zoomView } from "@shared/crop";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Sheet } from "@/components/ui/Sheet";
import { UnreadablePhotoError } from "@/lib/images";
import { decodePicture, renderProfilePicture } from "@/lib/profile-photo";
import { useObjectUrl } from "@/lib/use-object-url";

/** Side of the square the picture is placed in. The circle fills it. */
const SIZE = 264;
const NUDGE = 24;

interface CropSheetProps {
  /** The chosen photo; the sheet is open while there is one. */
  file: File | null;
  onClose: () => void;
  onChooseAnother: () => void;
  onSave: (picture: Blob) => void;
  /** Given when there is a picture to take away: shows "Remove picture". */
  onRemove?: () => void;
}

/**
 * Places a photo in a circle: drag to move, pinch or scroll (or the slider) to zoom. What is inside the circle becomes
 * the profile picture, cut out in the browser (shared/crop.ts has the maths).
 */
export function CropSheet({ file, onClose, onChooseAnother, onSave, onRemove }: CropSheetProps) {
  const [kept, setKept] = useState<File | null>(null);
  // The sheet keeps showing the photo while it slides away.
  if (file && file !== kept) setKept(file);
  const shown = file ?? kept;
  const crop = useCrop(shown);
  const [saving, setSaving] = useState(false);
  return (
    <Sheet
      open={!!file}
      onOpenChange={(open) => !open && onClose()}
      title="Your picture"
      description="Drag to place it, pinch or scroll to zoom."
      footer={
        <div className="flex w-full gap-3">
          <Button variant="secondary" className="flex-1" onClick={onChooseAnother}>
            Choose another
          </Button>
          <Button
            variant="primary"
            className="flex-1"
            loading={saving}
            disabled={!crop.bitmap || !crop.view}
            onClick={async () => {
              if (!crop.bitmap || !crop.view) return;
              setSaving(true);
              try {
                onSave(await renderProfilePicture(crop.bitmap, crop.view));
                onClose();
              } finally {
                setSaving(false);
              }
            }}
          >
            Save
          </Button>
        </div>
      }
    >
      {shown && <Cropper file={shown} {...crop} />}
      {onRemove && (
        <div className="flex justify-center pb-1">
          <Button
            variant="quiet"
            size="sm"
            onClick={() => {
              onRemove();
              onClose();
            }}
          >
            Remove picture
          </Button>
        </div>
      )}
    </Sheet>
  );
}

/** Decodes the photo and holds where the window is. */
function useCrop(file: File | null) {
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [view, setView] = useState<CropView | null>(null);
  useEffect(() => {
    setBitmap(null);
    setView(null);
    setProblem(null);
    if (!file) return;
    let cancelled = false;
    let decoded: ImageBitmap | null = null;
    decodePicture(file).then(
      (result) => {
        if (cancelled) return result.close();
        decoded = result;
        setBitmap(result);
        setView(startView(result.width, result.height));
      },
      (error) =>
        !cancelled && setProblem(error instanceof UnreadablePhotoError ? error.message : "That file didn't open."),
    );
    return () => {
      cancelled = true;
      decoded?.close();
    };
  }, [file]);
  const update = (next: CropView) => bitmap && setView(clampView(bitmap.width, bitmap.height, next));
  return { bitmap, view, problem, update };
}

type Crop = ReturnType<typeof useCrop>;

function Cropper({ file, bitmap, view, problem, update }: { file: File } & Crop) {
  const url = useObjectUrl(file);
  const frame = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const viewRef = useRef<CropView | null>(null);
  viewRef.current = view;
  const updateRef = useRef(update);
  updateRef.current = update;

  // A wheel (or a trackpad pinch) zooms at the pointer; it must be non-passive to keep the page from scrolling.
  useEffect(() => {
    const element = frame.current;
    if (!element || !bitmap) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0015));
      const base = viewRef.current;
      if (base)
        updateRef.current(
          zoomView(bitmap.width, bitmap.height, base, factor, SIZE, {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
          }),
        );
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [bitmap]);

  const distance = () => {
    const [a, b] = [...pointers.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };

  function onPointerDown(event: React.PointerEvent) {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
  }
  function onPointerMove(event: React.PointerEvent) {
    const last = pointers.current.get(event.pointerId);
    if (!last || !bitmap || !view) return;
    const before = distance();
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.current.size === 2 && before > 0) {
      const rect = event.currentTarget.getBoundingClientRect();
      const [a, b] = [...pointers.current.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const middle = { x: (a.x + b.x) / 2 - rect.left, y: (a.y + b.y) / 2 - rect.top };
      update(zoomView(bitmap.width, bitmap.height, view, distance() / before, SIZE, middle));
    } else if (pointers.current.size === 1) {
      update(panView(bitmap.width, bitmap.height, view, event.clientX - last.x, event.clientY - last.y, SIZE));
    }
  }
  function onPointerUp(event: React.PointerEvent) {
    pointers.current.delete(event.pointerId);
  }
  function onKeyDown(event: React.KeyboardEvent) {
    if (!bitmap || !view) return;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [NUDGE, 0],
      ArrowRight: [-NUDGE, 0],
      ArrowUp: [0, NUDGE],
      ArrowDown: [0, -NUDGE],
    };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      update(panView(bitmap.width, bitmap.height, view, move[0], move[1], SIZE));
    } else if (event.key === "+" || event.key === "=") update(zoomView(bitmap.width, bitmap.height, view, 1.15, SIZE));
    else if (event.key === "-") update(zoomView(bitmap.width, bitmap.height, view, 1 / 1.15, SIZE));
  }

  // The image sits where the window says: `scale` screen px per source px.
  const scale = bitmap && view ? SIZE / (Math.min(bitmap.width, bitmap.height) / view.zoom) : 1;
  return (
    <div className="flex flex-col items-center gap-5 py-2">
      <div
        ref={frame}
        role="application"
        aria-label="Picture position. Arrow keys move it, plus and minus zoom."
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a keyboard way to place the picture
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        style={{ width: SIZE, height: SIZE }}
        className="bg-well focus-ring relative max-w-full cursor-grab touch-none overflow-hidden rounded-lg select-none active:cursor-grabbing"
        data-testid="crop-frame"
      >
        {url && bitmap && view && (
          <img
            src={url}
            alt=""
            draggable={false}
            className="pointer-events-none absolute top-0 left-0 max-w-none origin-top-left"
            style={{
              width: bitmap.width * scale,
              height: bitmap.height * scale,
              transform: `translate(${SIZE / 2 - view.cx * scale}px, ${SIZE / 2 - view.cy * scale}px)`,
            }}
          />
        )}
        {problem && (
          <p className="text-small text-ink-soft absolute inset-0 flex items-center p-6 text-center">{problem}</p>
        )}
        {/* The mask: everything outside the circle is dimmed, with a hairline on its edge. */}
        <div
          aria-hidden
          className="bg-veil-strong pointer-events-none absolute inset-0 [mask-image:radial-gradient(circle_closest-side,transparent_calc(100%-1px),black_100%)]"
        />
        <div
          aria-hidden
          className="ring-on-accent/60 pointer-events-none absolute inset-0 rounded-full ring-1 ring-inset"
        />
      </div>
      <label className="text-small text-ink-soft flex w-full items-center gap-3" style={{ maxWidth: SIZE }}>
        Zoom
        <input
          type="range"
          min={1}
          max={MAX_ZOOM}
          step={0.01}
          value={view?.zoom ?? 1}
          disabled={!view}
          onChange={(event) =>
            bitmap &&
            view &&
            update(zoomView(bitmap.width, bitmap.height, view, Number(event.target.value) / view.zoom, SIZE))
          }
          className="accent-ink min-w-0 flex-1"
        />
      </label>
    </div>
  );
}
