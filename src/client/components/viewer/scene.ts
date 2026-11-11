import type { Layer } from "@shared/gcode";
import { FEATURES } from "@shared/gcode";
import {
  BufferAttribute,
  CanvasTexture,
  Color,
  ColorManagement,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedInterleavedBuffer,
  InterleavedBufferAttribute,
  LinearSRGBColorSpace,
  Mesh,
  MeshBasicMaterial,
  NoToneMapping,
  PerspectiveCamera,
  PlaneGeometry,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  Shape,
  Sphere,
  TOUCH,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

/**
 * The 3D viewer's scene: a build plate that looks like the printer's, and the toolpaths as small extrusions, one
 * instanced box per segment, coloured by filament or by feature, with the layers above a limit left out (or, for a
 * print in progress, faded to a ghost). Raw sRGB values throughout (no colour management), so the picture matches the
 * tokens. Nothing here is imported until someone opens the viewer.
 */

ColorManagement.enabled = false;

/** The X2D's plate, in mm. **[uncertain]**: the file doesn't say, and a plate this size is what the print is drawn on. */
const PLATE = 256;
const PLATE_THICKNESS = 3;

export type ColorBy = "filament" | "feature";

const MAX_FILAMENTS = 16;
const MAX_FEATURES = 16;

const vertex = /* glsl */ `
attribute vec3 aStart;
attribute vec3 aEnd;
attribute vec2 aInfo; // layer, feature * 64 + filament
uniform float uTop;
uniform float uLive;
uniform float uWidth;
uniform float uHeight;
uniform float uMode;
uniform vec3 uFilament[${MAX_FILAMENTS}];
uniform vec3 uFeature[${MAX_FEATURES}];
uniform vec3 uGhost;
varying vec3 vColor;
varying vec3 vNormal;
varying float vGhost;
varying float vTop;

void main() {
  float layer = aInfo.x;
  if (layer > uTop + 0.5) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float feature = floor(aInfo.y / 64.0);
  float filament = aInfo.y - feature * 64.0;
  vec3 d = aEnd - aStart;
  float len = length(d);
  vec3 dir = len > 1e-4 ? d / len : vec3(1.0, 0.0, 0.0);
  vec3 up = vec3(0.0, 0.0, 1.0);
  vec3 side = cross(dir, up);
  side = length(side) > 1e-3 ? normalize(side) : vec3(0.0, 1.0, 0.0);
  float reach = uWidth * 0.5;
  vec3 p = aStart - dir * reach + dir * (len + uWidth) * position.x + side * position.y * uWidth + up * position.z * uHeight;
  vec3 n = dir * normal.x + side * normal.y + up * normal.z;
  vNormal = normalize(mat3(modelMatrix) * n);
  vec3 base = uMode < 0.5 ? uFilament[int(min(filament, ${MAX_FILAMENTS - 1}.0))] : uFeature[int(min(feature, ${MAX_FEATURES - 1}.0))];
  vGhost = (uLive >= 0.0 && layer > uLive + 0.5) ? 1.0 : 0.0;
  vColor = mix(base, uGhost, vGhost * 0.82);
  vTop = abs(layer - uTop) < 0.5 ? 1.0 : 0.0;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const fragment = /* glsl */ `
precision highp float;
varying vec3 vColor;
varying vec3 vNormal;
varying float vGhost;
varying float vTop;
uniform vec3 uLight;
uniform vec3 uSky;
uniform vec3 uGround;

void main() {
  vec3 n = normalize(vNormal);
  float key = max(dot(n, normalize(vec3(-0.45, 0.85, 0.5))), 0.0);
  float fill = max(dot(n, normalize(vec3(0.6, 0.25, -0.4))), 0.0);
  vec3 ambient = mix(uGround, uSky, n.y * 0.5 + 0.5);
  vec3 lit = vColor * (ambient * 0.62 + uLight * key * 0.5 + uLight * fill * 0.12);
  // The layer being drawn is a touch brighter, so the slider's position reads on the print.
  lit += vTop * 0.07;
  lit = mix(lit, vColor * 0.95 + 0.05, vGhost * 0.6);
  gl_FragColor = vec4(lit, 1.0);
}
`;

/** Reads a CSS custom property (any colour syntax) as an sRGB colour, through a 1 px canvas. */
export function cssColor(name: string, fallback = "gray"): Color {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  if (!context) return new Color(0.6, 0.6, 0.6);
  context.fillStyle = fallback;
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;
  return new Color(r / 255, g / 255, b / 255);
}

function hexColor(hex: string | null | undefined, fallback: Color): Color {
  return hex && /^#[0-9a-f]{6}$/i.test(hex) ? new Color(hex) : fallback.clone();
}

/** The colour a kind of move is drawn in (feature id), from the tokens. */
export function featureColor(id: number): Color {
  return cssColor(`--sg-feature-${id}`);
}

/** The plate's PEI texture: a fine speckle and soft stripes, in the plate's own colour. */
function plateTexture(base: Color, edge: Color): CanvasTexture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d");
  if (!g) return new CanvasTexture(canvas);
  g.fillStyle = `#${base.getHexString()}`;
  g.fillRect(0, 0, size, size);
  // A deterministic speckle (no Math.random: the same plate every time).
  let seed = 7;
  const next = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const light = base.clone().lerp(new Color(1, 1, 1), 0.35);
  for (let i = 0; i < 26000; i++) {
    const shade = next() < 0.5 ? edge : light;
    g.globalAlpha = 0.05 + next() * 0.16;
    g.fillStyle = `#${shade.getHexString()}`;
    const s = 0.6 + next() * 1.1;
    g.fillRect(next() * size, next() * size, s, s);
  }
  g.globalAlpha = 0.05;
  g.fillStyle = `#${edge.getHexString()}`;
  for (let y = 0; y < size; y += 6) g.fillRect(0, y, size, 1);
  const texture = new CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.colorSpace = LinearSRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function roundedPlate(): Shape {
  const r = 14;
  const s = new Shape();
  s.moveTo(r, 0);
  s.lineTo(PLATE - r, 0);
  s.quadraticCurveTo(PLATE, 0, PLATE, r);
  s.lineTo(PLATE, PLATE - r);
  s.quadraticCurveTo(PLATE, PLATE, PLATE - r, PLATE);
  s.lineTo(r, PLATE);
  s.quadraticCurveTo(0, PLATE, 0, PLATE - r);
  s.lineTo(0, r);
  s.quadraticCurveTo(0, 0, r, 0);
  return s;
}

function shadowTexture(): CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d");
  if (g) {
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, "black");
    grad.addColorStop(1, "transparent");
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = LinearSRGBColorSpace;
  return texture;
}

/** One unit box: x along the move (0–1), y across (±0.5), z from the layer's top down (−1–0), with its normals. */
function boxGeometry(): InstancedBufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const face = (n: [number, number, number], corners: [number, number, number][]) => {
    const base = positions.length / 3;
    for (const c of corners) {
      positions.push(...c);
      normals.push(...n);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  face(
    [0, 0, 1],
    [
      [0, -0.5, 0],
      [1, -0.5, 0],
      [1, 0.5, 0],
      [0, 0.5, 0],
    ],
  );
  face(
    [0, 0, -1],
    [
      [0, -0.5, -1],
      [0, 0.5, -1],
      [1, 0.5, -1],
      [1, -0.5, -1],
    ],
  );
  face(
    [0, 1, 0],
    [
      [0, 0.5, 0],
      [1, 0.5, 0],
      [1, 0.5, -1],
      [0, 0.5, -1],
    ],
  );
  face(
    [0, -1, 0],
    [
      [0, -0.5, 0],
      [0, -0.5, -1],
      [1, -0.5, -1],
      [1, -0.5, 0],
    ],
  );
  face(
    [1, 0, 0],
    [
      [1, -0.5, 0],
      [1, -0.5, -1],
      [1, 0.5, -1],
      [1, 0.5, 0],
    ],
  );
  face(
    [-1, 0, 0],
    [
      [0, -0.5, 0],
      [0, 0.5, 0],
      [0, 0.5, -1],
      [0, -0.5, -1],
    ],
  );
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("normal", new BufferAttribute(new Float32Array(normals), 3));
  geometry.setIndex(indices);
  return geometry;
}

export interface SceneColors {
  plate: Color;
  plateEdge: Color;
  light: Color;
  sky: Color;
  ground: Color;
}

export class PrintScene {
  readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(32, 1, 5, 4000);
  private readonly controls: OrbitControls;
  /** The printer's frame (x right, y back, z up) turned into three's (y up). */
  private readonly print = new Group();
  private readonly material: ShaderMaterial;
  private readonly box = boxGeometry();
  private readonly chunks: Mesh[] = [];
  private plate: Group | null = null;
  private shadow: Mesh | null = null;
  private frame = 0;
  private animating = false;
  private disposed = false;
  private width = 1;
  private height = 1;
  private layers = 0;
  private bounds: [number, number, number, number, number, number] | null = null;
  private fitted = false;
  private layerHeight = 0.2;

  private readonly canvas: HTMLCanvasElement;
  private readonly onDirty?: () => void;

  constructor(canvas: HTMLCanvasElement, onDirty?: () => void) {
    this.canvas = canvas;
    this.onDirty = onDirty;
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    this.renderer.outputColorSpace = LinearSRGBColorSpace;
    this.renderer.toneMapping = NoToneMapping;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));

    this.print.rotation.x = -Math.PI / 2;
    this.scene.add(this.print);

    this.material = new ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: {
        uTop: { value: 0 },
        uLive: { value: -1 },
        uWidth: { value: 0.45 },
        uHeight: { value: 0.2 },
        uMode: { value: 0 },
        uFilament: { value: Array.from({ length: MAX_FILAMENTS }, () => new Color(0.8, 0.77, 0.7)) },
        uFeature: { value: Array.from({ length: MAX_FEATURES }, () => new Color(0.6, 0.6, 0.6)) },
        uGhost: { value: new Color(0.85, 0.8, 0.7) },
        uLight: { value: new Color(1, 0.95, 0.88) },
        uSky: { value: new Color(1, 0.98, 0.94) },
        uGround: { value: new Color(0.62, 0.55, 0.47) },
      },
      side: DoubleSide,
    });
    this.setFeatureColors();

    this.camera.up.set(0, 1, 0);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.screenSpacePanning = true;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.03;
    this.controls.minDistance = 20;
    // One finger turns the print, two pinch to zoom and drag to pan.
    this.controls.touches = { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN };
    this.controls.addEventListener("change", () => this.dirty());
    this.camera.position.set(PLATE / 2 + 160, 190, PLATE / 2 + 260);
    this.controls.target.set(PLATE / 2, 20, -PLATE / 2);
    this.controls.update();
  }

  /** The plate and its light, in the colours of the current theme. */
  setTheme(colors: SceneColors) {
    const u = this.material.uniforms;
    for (const [name, color] of [
      ["uLight", colors.light],
      ["uSky", colors.sky],
      ["uGround", colors.ground],
      ["uGhost", colors.plate],
    ] as const) {
      (u[name]?.value as Color | undefined)?.copy(color);
    }
    if (this.plate) {
      this.print.remove(this.plate);
      this.plate.traverse((o) => {
        if (o instanceof Mesh) {
          o.geometry.dispose();
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
            (m as MeshBasicMaterial).map?.dispose();
            m.dispose();
          }
        }
      });
    }
    const plate = new Group();
    const top = new MeshBasicMaterial({ map: plateTexture(colors.plate, colors.plateEdge) });
    top.map?.repeat.set(1 / 64, 1 / 64);
    const side = new MeshBasicMaterial({ color: colors.plateEdge });
    const geometry = new ExtrudeGeometry(roundedPlate(), {
      depth: PLATE_THICKNESS,
      bevelEnabled: true,
      bevelThickness: 0.8,
      bevelSize: 0.8,
      bevelSegments: 2,
      curveSegments: 10,
    });
    const slab = new Mesh(geometry, [top, side]);
    slab.position.z = -PLATE_THICKNESS - 0.8;
    plate.add(slab);
    this.plate = plate;
    this.print.add(plate);
    if (!this.shadow) {
      this.shadow = new Mesh(
        new PlaneGeometry(1, 1),
        new MeshBasicMaterial({ map: shadowTexture(), transparent: true, opacity: 0.3, depthWrite: false }),
      );
      this.shadow.renderOrder = -1;
      this.print.add(this.shadow);
      this.placeShadow();
    }
    this.dirty();
  }

  private setFeatureColors() {
    const list = this.material.uniforms.uFeature?.value as Color[];
    for (let i = 0; i < MAX_FEATURES; i++) list[i]?.copy(featureColor(i));
  }

  setFilaments(colors: (string | null)[]) {
    const list = this.material.uniforms.uFilament?.value as Color[];
    const fallback = Array.from({ length: 8 }, (_, i) => cssColor(`--sg-fil-${i}`));
    for (let i = 0; i < MAX_FILAMENTS; i++) {
      list[i]?.copy(hexColor(colors[i], fallback[i % fallback.length] ?? new Color(0.8, 0.77, 0.7)));
    }
    this.dirty();
  }

  setMode(mode: ColorBy) {
    (this.material.uniforms.uMode as { value: number }).value = mode === "filament" ? 0 : 1;
    this.dirty();
  }

  /** Shows layers 0 … `index` (counting from 0). */
  setLayer(index: number) {
    (this.material.uniforms.uTop as { value: number }).value = index;
    this.dirty();
  }

  /** The layers after `index` are a faint ghost: a print that has got that far. `null` is a finished print. */
  setLive(index: number | null) {
    (this.material.uniforms.uLive as { value: number }).value = index ?? -1;
    this.dirty();
  }

  /** Adds layers (in order). The first batch frames the print. */
  addLayers(layers: Layer[]) {
    if (!layers.length) return;
    let segments = 0;
    for (const l of layers) segments += l.count;
    if (!segments) return;
    const pos = new Float32Array(segments * 6);
    const info = new Float32Array(segments * 2);
    let at = 0;
    for (const l of layers) {
      pos.set(l.pos, at * 6);
      for (let i = 0; i < l.count; i++) {
        info[(at + i) * 2] = l.index;
        info[(at + i) * 2 + 1] = (l.feature[i] ?? 0) * 64 + (l.filament[i] ?? 0);
      }
      at += l.count;
      this.layers = Math.max(this.layers, l.index + 1);
      if (l.height > 0 && l.index === 1) this.setLayerHeight(l.height);
      if (l.index === 0 && l.height > 0) this.setLayerHeight(l.height);
      for (let i = 0; i < l.count; i++) this.grow(l.pos, i * 6, l.feature[i] ?? 0);
    }
    const geometry = new InstancedBufferGeometry();
    geometry.index = this.box.index;
    geometry.attributes = this.box.attributes;
    const buffer = new InstancedInterleavedBuffer(pos, 6, 1);
    geometry.setAttribute("aStart", new InterleavedBufferAttribute(buffer, 3, 0));
    geometry.setAttribute("aEnd", new InterleavedBufferAttribute(buffer, 3, 3));
    geometry.setAttribute("aInfo", new InstancedBufferAttribute(info, 2));
    geometry.instanceCount = segments;
    geometry.boundingSphere = new Sphere(new Vector3(PLATE / 2, PLATE / 2, 20), PLATE * 2);
    const mesh = new Mesh(geometry, this.material);
    mesh.frustumCulled = false;
    this.print.add(mesh);
    this.chunks.push(mesh);
    this.placeShadow();
    if (!this.fitted && this.bounds) this.fit();
    this.dirty();
  }

  private setLayerHeight(h: number) {
    this.layerHeight = h;
    (this.material.uniforms.uHeight as { value: number }).value = h;
    (this.material.uniforms.uWidth as { value: number }).value = Math.max(0.42, h * 1.7);
  }

  /** The print's extent for framing: the prime tower isn't part of the object, so it doesn't pull the camera back. */
  private grow(p: Float32Array, o: number, feature: number) {
    if (feature === 13) return;
    const x0 = p[o] ?? 0;
    const y0 = p[o + 1] ?? 0;
    const z0 = p[o + 2] ?? 0;
    const x1 = p[o + 3] ?? 0;
    const y1 = p[o + 4] ?? 0;
    const z1 = p[o + 5] ?? 0;
    const b = this.bounds;
    if (!b) {
      this.bounds = [
        Math.min(x0, x1),
        Math.min(y0, y1),
        Math.min(z0, z1),
        Math.max(x0, x1),
        Math.max(y0, y1),
        Math.max(z0, z1),
      ];
      return;
    }
    b[0] = Math.min(b[0], x0, x1);
    b[1] = Math.min(b[1], y0, y1);
    b[2] = Math.min(b[2], z0, z1);
    b[3] = Math.max(b[3], x0, x1);
    b[4] = Math.max(b[4], y0, y1);
    b[5] = Math.max(b[5], z0, z1);
  }

  /** The soft shadow the print casts on the plate, as wide as what is printed. */
  private placeShadow() {
    if (!this.shadow) return;
    const b = this.bounds;
    if (!b) {
      this.shadow.visible = false;
      return;
    }
    this.shadow.visible = true;
    const w = (b[3] - b[0]) * 1.5 + 14;
    const h = (b[4] - b[1]) * 1.5 + 14;
    this.shadow.scale.set(w, h, 1);
    this.shadow.position.set((b[0] + b[3]) / 2 + 3, (b[1] + b[4]) / 2 - 4, 0.05);
  }

  /** Frames the print: the camera looks at its middle from the front, a little above and to one side. */
  fit() {
    const b = this.bounds;
    if (!b) return;
    this.fitted = true;
    const cx = (b[0] + b[3]) / 2;
    const cy = (b[1] + b[4]) / 2;
    const cz = Math.min((b[5] - b[2]) / 2, 60);
    const radius = Math.max(40, Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) / 2);
    const fov = (this.camera.fov * Math.PI) / 180;
    const aspect = this.width / this.height;
    const fitFov = aspect < 1 ? 2 * Math.atan(Math.tan(fov / 2) * aspect) : fov;
    const distance = Math.max(90, (radius * 1.5) / Math.sin(fitFov / 2));
    // three's frame: x → x, z → −y, y → z.
    this.controls.target.set(cx, cz, -cy);
    this.camera.position.set(cx + distance * 0.42, cz + distance * 0.5, -cy + distance * 0.76);
    this.controls.maxDistance = distance * 5;
    this.controls.update();
    this.dirty();
  }

  resize(width: number, height: number) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    if (this.bounds && !this.fitted) this.fit();
    this.dirty();
  }

  /** Draws on the next frame; keeps drawing while the controls glide to a stop. */
  dirty() {
    this.onDirty?.();
    if (this.animating || this.disposed) return;
    this.animating = true;
    this.frame = requestAnimationFrame(this.tick);
  }

  private tick = () => {
    this.animating = false;
    if (this.disposed) return;
    const moved = this.controls.update();
    this.renderer.render(this.scene, this.camera);
    if (moved) this.dirty();
  };

  /** A still of the current view, as a data URL (for a hero without a photo). */
  snapshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.canvas.toDataURL("image/png");
  }

  get layerCount() {
    return this.layers;
  }

  /** The printed height in mm, for the readout. */
  get thickness() {
    return this.layerHeight;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.controls.dispose();
    for (const m of this.chunks) m.geometry.dispose();
    this.box.dispose();
    this.material.dispose();
    this.renderer.dispose();
  }
}

export function legendFeatures(used: Set<number>): { id: number; name: string; color: string }[] {
  return [...used]
    .sort((a, b) => a - b)
    .map((id) => ({ id, name: FEATURES[id] ?? "Other", color: `#${featureColor(id).getHexString()}` }));
}
