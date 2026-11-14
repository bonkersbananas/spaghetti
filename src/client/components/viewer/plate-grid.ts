import {
  BufferGeometry,
  type Color,
  DoubleSide,
  Float32BufferAttribute,
  Mesh,
  ShaderMaterial,
  Uint32BufferAttribute,
  Vector2,
} from "three";

/**
 * The plate seen from below: its outline and a grid of lines across it, drawn as quads with a width in CSS pixels
 * (a WebGL line is one device pixel, so it would thin out on 2x and 3x screens). The outline is heavier than the lines.
 * Drawn first and without touching depth, so the print always covers it.
 */

const vertex = /* glsl */ `
attribute vec3 aA;
attribute vec3 aB;
attribute vec2 aCorner; // x: 0 at A, 1 at B; y: -1 or 1 across the line
attribute vec2 aStyle;  // width in px, strength 0..1
uniform vec2 uViewport; // CSS px
varying float vStrength;

void main() {
  vec4 a = projectionMatrix * modelViewMatrix * vec4(aA, 1.0);
  vec4 b = projectionMatrix * modelViewMatrix * vec4(aB, 1.0);
  // Keep the part of the segment in front of the camera.
  const float eps = 0.5;
  if (a.w < eps && b.w < eps) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  if (a.w < eps) a = mix(a, b, (eps - a.w) / (b.w - a.w));
  if (b.w < eps) b = mix(b, a, (eps - b.w) / (a.w - b.w));
  vec2 sa = a.xy / a.w * uViewport * 0.5;
  vec2 sb = b.xy / b.w * uViewport * 0.5;
  vec2 dir = sb - sa;
  dir = length(dir) > 1e-4 ? normalize(dir) : vec2(1.0, 0.0);
  vec2 perp = vec2(-dir.y, dir.x);
  vec4 p = aCorner.x < 0.5 ? a : b;
  float reach = aStyle.x * 0.5;
  vec2 offset = (perp * aCorner.y * reach + dir * (aCorner.x < 0.5 ? -reach : reach)) / (uViewport * 0.5);
  p.xy += offset * p.w;
  gl_Position = p;
  vStrength = aStyle.y;
}
`;

const fragment = /* glsl */ `
precision highp float;
uniform vec3 uColor;
uniform float uOpacity;
varying float vStrength;
void main() {
  gl_FragColor = vec4(uColor, uOpacity * vStrength);
}
`;

export interface GridSegment {
  a: [number, number];
  b: [number, number];
  width: number;
  strength: number;
}

/** The segments of a plate `size` mm square with corners rounded by `radius`: its outline, then the lines across. */
export function plateSegments(size: number, radius: number, step: number, outlinePx: number, linePx: number) {
  const segments: GridSegment[] = [];
  const outline: [number, number][] = [];
  const arc = (cx: number, cy: number, from: number) => {
    for (let i = 0; i <= 6; i++) {
      const t = from + (i / 6) * (Math.PI / 2);
      outline.push([cx + Math.cos(t) * radius, cy + Math.sin(t) * radius]);
    }
  };
  arc(size - radius, radius, -Math.PI / 2);
  arc(size - radius, size - radius, 0);
  arc(radius, size - radius, Math.PI / 2);
  arc(radius, radius, Math.PI);
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    if (a && b) segments.push({ a, b, width: outlinePx, strength: 1 });
  }
  for (let v = step; v < size; v += step) {
    segments.push({ a: [v, radius], b: [v, size - radius], width: linePx, strength: 0.7 });
    segments.push({ a: [radius, v], b: [size - radius, v], width: linePx, strength: 0.7 });
  }
  return segments;
}

export function gridGeometry(segments: GridSegment[]): BufferGeometry {
  const a: number[] = [];
  const b: number[] = [];
  const corner: number[] = [];
  const style: number[] = [];
  const index: number[] = [];
  segments.forEach((s, i) => {
    for (const [x, y] of [
      [0, -1],
      [0, 1],
      [1, -1],
      [1, 1],
    ] as const) {
      a.push(s.a[0], s.a[1], 0);
      b.push(s.b[0], s.b[1], 0);
      corner.push(x, y);
      style.push(s.width, s.strength);
    }
    const o = i * 4;
    index.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
  });
  const g = new BufferGeometry();
  // three wants a `position` to count vertices; the shader reads aA/aB.
  g.setAttribute("position", new Float32BufferAttribute(a, 3));
  g.setAttribute("aA", new Float32BufferAttribute(a, 3));
  g.setAttribute("aB", new Float32BufferAttribute(b, 3));
  g.setAttribute("aCorner", new Float32BufferAttribute(corner, 2));
  g.setAttribute("aStyle", new Float32BufferAttribute(style, 2));
  g.setIndex(new Uint32BufferAttribute(index, 1));
  return g;
}

export function plateGrid(size: number, radius: number, step: number, outlinePx: number, linePx: number, color: Color) {
  const material = new ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms: { uColor: { value: color.clone() }, uOpacity: { value: 0 }, uViewport: { value: new Vector2(1, 1) } },
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: DoubleSide,
  });
  const mesh = new Mesh(gridGeometry(plateSegments(size, radius, step, outlinePx, linePx)), material);
  mesh.frustumCulled = false;
  return mesh;
}
