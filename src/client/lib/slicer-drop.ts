/**
 * Which files are slicer files, and where a dropped one goes. Small on purpose: the capture sheet and the drop overlay
 * load it with the app, while reading and keeping a file (slicer-files.ts) loads with the screens that do it.
 */
import { type RefObject, useEffect, useRef } from "react";

/** Sliced .gcode.3mf from Bambu Studio and Orca Slicer, and models to slice: .stl and plain .3mf. */
export const SLICER_ACCEPT = ".3mf,.stl,model/3mf,model/stl,application/vnd.ms-package.3dmanufacturing-3dmodel+xml";
export const isSlicerFile = (file: File) => /\.(3mf|stl)$/i.test(file.name);

/** Where a dropped .3mf goes: the open attempt sheet first, else the build on screen. */
type DropHandler = (file: File, attemptId: string | null) => void;
const targets: Array<{ handler: RefObject<DropHandler> }> = [];
const listeners = new Set<() => void>();

/** While mounted (and enabled), a dropped .3mf goes to `handler`; the latest registered wins. */
export function useSlicerDropTarget(handler: DropHandler, enabled = true) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!enabled) return;
    const entry = { handler: ref };
    targets.push(entry);
    for (const listener of listeners) listener();
    return () => {
      targets.splice(targets.indexOf(entry), 1);
      for (const listener of listeners) listener();
    };
  }, [enabled]);
}

/** Whether a dropped .3mf has somewhere to go on this screen. */
export function hasSlicerDropTarget(): boolean {
  return targets.length > 0;
}

export function subscribeSlicerDropTargets(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Hands a dropped .3mf to the screen; false when nothing on screen takes one. */
export function takeSlicerDrop(file: File, attemptId: string | null): boolean {
  const target = targets.at(-1);
  if (!target) return false;
  target.handler.current(file, attemptId);
  return true;
}
