import type { Mesh } from "@shared/mesh";
import { useEffect, useRef } from "react";
import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  DirectionalLight,
  Group,
  MeshLambertMaterial,
  PerspectiveCamera,
  Scene,
  Mesh as ThreeMesh,
  WebGLRenderer,
} from "three";
import { cn } from "@/lib/cn";
import { cssColor } from "../viewer/scene";

/** The preview's turn: one revolution in about 40 seconds, a calm turntable. */
const TURN_PER_MS = (Math.PI * 2) / 40_000;

/**
 * A live 3D look at a mesh, on the build plate's colour: it turns slowly (not at all with reduced motion) and is
 * redrawn when the mesh changes. The mesh is in the printer's frame (z up); three's y is up, so it is turned over.
 * Loaded with the adapt sheet, from the same three chunk as the print viewer.
 */
export function MeshPreview({ mesh, className }: { mesh: Mesh; className?: string }) {
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const redraw = useRef<((mesh: Mesh) => void) | null>(null);
  const latest = useRef(mesh);
  latest.current = mesh;

  useEffect(() => {
    const element = canvas.current;
    const box = stage.current;
    if (!element || !box) return;
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ canvas: element, antialias: true, alpha: true });
    } catch {
      return; // No WebGL: the size under the picture still says what it will be.
    }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    const scene = new Scene();
    const camera = new PerspectiveCamera(30, 1, 0.1, 100_000);
    const turntable = new Group();
    scene.add(turntable);
    const material = new MeshLambertMaterial({ color: cssColor("--sg-studio-sky"), flatShading: true });
    scene.add(new AmbientLight(cssColor("--sg-studio-ground"), 2.2));
    const key = new DirectionalLight(cssColor("--sg-studio-light"), 2.6);
    key.position.set(-0.6, 1, 0.8);
    scene.add(key);
    let model: ThreeMesh | null = null;
    let radius = 1;
    let frame = 0;
    let turned = 0.6;
    let last = 0;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const draw = () => {
      turntable.rotation.y = turned;
      renderer.render(scene, camera);
    };
    const tick = (now: number) => {
      turned += (last ? now - last : 0) * TURN_PER_MS;
      last = now;
      draw();
      frame = requestAnimationFrame(tick);
    };
    const resize = () => {
      const { clientWidth: w, clientHeight: h } = box;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      // Far enough that the model's bounding sphere fits the narrower side.
      const half = (camera.fov * Math.PI) / 360;
      const fit = radius / Math.sin(Math.min(half, Math.atan(Math.tan(half) * camera.aspect)));
      camera.position.set(0, fit * 0.42, fit * 0.91);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
      draw();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(box);

    redraw.current = (next) => {
      if (model) {
        turntable.remove(model);
        model.geometry.dispose();
      }
      const source = next.positions;
      const positions = new Float32Array(source.length);
      let minX = Infinity;
      let minY = Infinity;
      let minZ = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      let maxZ = -Infinity;
      for (let i = 0; i < source.length; i += 3) {
        // (x, y, z) in the file is (x, z, −y) on screen.
        const x = source[i] as number;
        const y = source[i + 2] as number;
        const z = -(source[i + 1] as number);
        positions[i] = x;
        positions[i + 1] = y;
        positions[i + 2] = z;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const cz = (minZ + maxZ) / 2;
      for (let i = 0; i < positions.length; i += 3) {
        positions[i] = (positions[i] as number) - cx;
        positions[i + 1] = (positions[i + 1] as number) - cy;
        positions[i + 2] = (positions[i + 2] as number) - cz;
      }
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new BufferAttribute(positions, 3));
      model = new ThreeMesh(geometry, material);
      turntable.add(model);
      radius = Math.max(1e-6, Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2);
      resize();
    };
    redraw.current(latest.current);
    if (!reduced) frame = requestAnimationFrame(tick);

    return () => {
      redraw.current = null;
      cancelAnimationFrame(frame);
      observer.disconnect();
      model?.geometry.dispose();
      material.dispose();
      renderer.dispose();
    };
  }, []);

  useEffect(() => {
    redraw.current?.(mesh);
  }, [mesh]);

  return (
    <div
      ref={stage}
      className={cn("h-48 w-full overflow-hidden rounded-xl bg-[var(--sg-plate)] md:h-64", className)}
      role="img"
      aria-label="The model as it will be"
    >
      <canvas ref={canvas} className="block size-full" />
    </div>
  );
}
