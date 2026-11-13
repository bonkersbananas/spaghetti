//! The plate picture: the objects as they sit on the plate, seen from the front left and above, in the filament's
//! colour on a clear background (the app's `render.ts`, ported: a z-buffer, flat Lambert shading, 2× supersampling),
//! and a small PNG encoder for it.

use crate::mesh::Mesh;

const AZIMUTH: f64 = -30.0;
const ELEVATION: f64 = 35.0;
const SUPERSAMPLE: usize = 2;
const MARGIN: f64 = 0.1;

/// RGBA pixels, `size` × `size`.
pub fn render(meshes: &[Mesh], size: usize, colour: &str) -> Vec<u8> {
    let big = size * SUPERSAMPLE;
    let az = AZIMUTH.to_radians();
    let el = ELEVATION.to_radians();
    let forward = [az.sin() * el.cos(), az.cos() * el.cos(), -el.sin()];
    let right = [az.cos(), -az.sin(), 0.0];
    let up = [
        right[1] * forward[2] - right[2] * forward[1],
        right[2] * forward[0] - right[0] * forward[2],
        right[0] * forward[1] - right[1] * forward[0],
    ];
    let key = normalize([-0.45, -0.6, 0.75]);
    let fill = normalize([0.7, -0.2, 0.3]);
    let base = rgb(colour);

    let (mut min_x, mut max_x, mut min_y, mut max_y) =
        (f64::INFINITY, f64::NEG_INFINITY, f64::INFINITY, f64::NEG_INFINITY);
    for mesh in meshes {
        for v in &mesh.vertices {
            let (x, y, z) = (v[0] as f64, v[1] as f64, v[2] as f64);
            let sx = x * right[0] + y * right[1];
            let sy = x * up[0] + y * up[1] + z * up[2];
            min_x = min_x.min(sx);
            max_x = max_x.max(sx);
            min_y = min_y.min(sy);
            max_y = max_y.max(sy);
        }
    }
    let mut out = vec![0u8; size * size * 4];
    if !min_x.is_finite() {
        return out;
    }
    let extent = (max_x - min_x).max(max_y - min_y).max(1e-3);
    let scale = big as f64 * (1.0 - 2.0 * MARGIN) / extent;
    let offset_x = big as f64 / 2.0 - (min_x + max_x) / 2.0 * scale;
    let offset_y = big as f64 / 2.0 + (min_y + max_y) / 2.0 * scale;

    // Each vertex once to the screen, and each triangle's colour and screen box once.
    struct Tri {
        p: [[f32; 3]; 3],
        area: f32,
        colour: u32,
        y0: u16,
        y1: u16,
    }
    let screens: Vec<Vec<[f64; 3]>> = meshes
        .iter()
        .map(|mesh| {
            mesh.vertices
                .iter()
                .map(|v| {
                    let (x, y, z) = (v[0] as f64, v[1] as f64, v[2] as f64);
                    [
                        offset_x + (x * right[0] + y * right[1]) * scale,
                        offset_y - (x * up[0] + y * up[1] + z * up[2]) * scale,
                        x * forward[0] + y * forward[1] + z * forward[2],
                    ]
                })
                .collect()
        })
        .collect();
    // Shade and place the triangles in chunks (in parallel where there are threads).
    const CHUNK: usize = 16384;
    let chunks: Vec<(usize, usize)> = meshes
        .iter()
        .enumerate()
        .flat_map(|(m, mesh)| (0..mesh.triangles.len().div_ceil(CHUNK)).map(move |c| (m, c * CHUNK)))
        .collect();
    let prepared: Vec<Vec<Tri>> = crate::par::map_range(chunks.len(), |k| {
        let (m, from) = chunks[k];
        let (mesh, screen) = (&meshes[m], &screens[m]);
        let mut out = Vec::with_capacity(CHUNK);
        for t in &mesh.triangles[from..(from + CHUNK).min(mesh.triangles.len())] {
            let [a, b, c] = t.map(|i| mesh.vertices[i as usize]);
            let u = [b[0] as f64 - a[0] as f64, b[1] as f64 - a[1] as f64, b[2] as f64 - a[2] as f64];
            let w = [c[0] as f64 - a[0] as f64, c[1] as f64 - a[1] as f64, c[2] as f64 - a[2] as f64];
            let mut n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
            let length = (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).sqrt();
            if length == 0.0 {
                continue;
            }
            n = [n[0] / length, n[1] / length, n[2] / length];
            // Faces turned away still draw (a model with flipped faces stays whole), lit as if they faced us.
            if n[0] * forward[0] + n[1] * forward[1] + n[2] * forward[2] > 0.0 {
                n = [-n[0], -n[1], -n[2]];
            }
            let lambert = 0.38
                + 0.55 * (n[0] * key[0] + n[1] * key[1] + n[2] * key[2]).max(0.0)
                + 0.2 * (n[0] * fill[0] + n[1] * fill[1] + n[2] * fill[2]).max(0.0);
            let shade = lambert.min(1.08);
            let channel = |v: u8| ((v as f64 * shade).round().min(255.0)) as u32;
            let colour = (channel(base[0]) << 16) | (channel(base[1]) << 8) | channel(base[2]);
            let p = t.map(|i| screen[i as usize]);
            let area = (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[1][1] - p[0][1]) * (p[2][0] - p[0][0]);
            let top = p[0][1].min(p[1][1]).min(p[2][1]).floor();
            let bottom = p[0][1].max(p[1][1]).max(p[2][1]).ceil();
            if area == 0.0 || bottom < 0.0 || top > (big - 1) as f64 {
                continue;
            }
            out.push(Tri {
                p: p.map(|q| q.map(|v| v as f32)),
                area: area as f32,
                colour,
                y0: top.max(0.0) as u16,
                y1: (bottom as usize).min(big - 1) as u16,
            });
        }
        out
    });
    let tris: Vec<Tri> = prepared.into_iter().flatten().collect();

    // Bands of rows, each drawn on its own (in parallel where there are threads).
    const BAND: usize = 32;
    let bands = big.div_ceil(BAND);
    let mut starts = vec![0usize; bands + 1];
    for t in &tris {
        for b in t.y0 as usize / BAND..=t.y1 as usize / BAND {
            starts[b + 1] += 1;
        }
    }
    for b in 0..bands {
        starts[b + 1] += starts[b];
    }
    let mut fill_at = starts.clone();
    let mut binned = vec![0u32; starts[bands]];
    for (i, t) in tris.iter().enumerate() {
        for b in t.y0 as usize / BAND..=t.y1 as usize / BAND {
            binned[fill_at[b]] = i as u32;
            fill_at[b] += 1;
        }
    }
    let drawn: Vec<(Vec<f32>, Vec<u32>)> = crate::par::map_range(bands, |band| {
        let (r0, r1) = (band * BAND, ((band + 1) * BAND).min(big) - 1);
        let rows = r1 - r0 + 1;
        let mut depth = vec![f32::INFINITY; rows * big];
        let mut colours = vec![0u32; rows * big];
        for &i in &binned[starts[band]..starts[band + 1]] {
            let t = &tris[i as usize];
            let [p0, p1, p2] = t.p.map(|q| q.map(f64::from));
            let x0 = p0[0].min(p1[0]).min(p2[0]).floor().max(0.0) as usize;
            let x1 = (p0[0].max(p1[0]).max(p2[0]).ceil() as isize).min(big as isize - 1);
            if x1 < 0 {
                continue;
            }
            // The barycentric weights are linear across a row: step them instead of solving each pixel.
            let inv = 1.0 / t.area as f64;
            let (d0, d1) = ((p1[1] - p2[1]) * inv, (p2[1] - p0[1]) * inv);
            let (z0, z1, z2) = (p0[2] - p2[2], p1[2] - p2[2], p2[2]);
            let sx0 = x0 as f64 + 0.5;
            for py in (t.y0 as usize).max(r0)..=(t.y1 as usize).min(r1) {
                let sy = py as f64 + 0.5;
                let mut w0 = ((p1[0] - sx0) * (p2[1] - sy) - (p1[1] - sy) * (p2[0] - sx0)) * inv;
                let mut w1 = ((p2[0] - sx0) * (p0[1] - sy) - (p2[1] - sy) * (p0[0] - sx0)) * inv;
                let row = (py - r0) * big;
                for px in x0..=x1 as usize {
                    if w0 >= 0.0 && w1 >= 0.0 && w0 + w1 <= 1.0 {
                        let z = (z2 + w0 * z0 + w1 * z1) as f32;
                        let at = row + px;
                        if z < depth[at] {
                            depth[at] = z;
                            colours[at] = t.colour;
                        }
                    }
                    w0 += d0;
                    w1 += d1;
                }
            }
        }
        (depth, colours)
    });
    let mut depth = Vec::with_capacity(big * big);
    let mut colours = Vec::with_capacity(big * big);
    for (d, c) in drawn {
        depth.extend(d);
        colours.extend(c);
    }

    let samples = (SUPERSAMPLE * SUPERSAMPLE) as u32;
    for y in 0..size {
        for x in 0..size {
            let (mut r, mut g, mut b, mut covered) = (0u32, 0u32, 0u32, 0u32);
            for dy in 0..SUPERSAMPLE {
                for dx in 0..SUPERSAMPLE {
                    let at = (y * SUPERSAMPLE + dy) * big + x * SUPERSAMPLE + dx;
                    if depth[at].is_infinite() {
                        continue;
                    }
                    let c = colours[at];
                    r += (c >> 16) & 255;
                    g += (c >> 8) & 255;
                    b += c & 255;
                    covered += 1;
                }
            }
            if covered == 0 {
                continue;
            }
            let o = (y * size + x) * 4;
            out[o] = (r / covered) as u8;
            out[o + 1] = (g / covered) as u8;
            out[o + 2] = (b / covered) as u8;
            out[o + 3] = (255 * covered / samples) as u8;
        }
    }
    out
}

fn normalize(v: [f64; 3]) -> [f64; 3] {
    let l = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
    [v[0] / l, v[1] / l, v[2] / l]
}

/// "#F2754E" → its channels (the app's orange when it can't be read).
fn rgb(hex: &str) -> [u8; 3] {
    let h = hex.trim().trim_start_matches('#');
    let value = if h.len() >= 6 { u32::from_str_radix(&h[..6], 16).unwrap_or(0xF2754E) } else { 0xF2754E };
    [(value >> 16) as u8, (value >> 8) as u8, value as u8]
}

/// RGBA pixels as a PNG (8-bit, colour with alpha).
pub fn encode(rgba: &[u8], width: usize, height: usize) -> Vec<u8> {
    let mut raw = Vec::with_capacity((width * 4 + 1) * height);
    for row in rgba.chunks_exact(width * 4) {
        raw.push(0); // no filter
        raw.extend_from_slice(row);
    }
    let mut png = Vec::with_capacity(raw.len() / 4 + 64);
    png.extend_from_slice(b"\x89PNG\r\n\x1a\n");
    let mut ihdr = Vec::with_capacity(13);
    ihdr.extend_from_slice(&(width as u32).to_be_bytes());
    ihdr.extend_from_slice(&(height as u32).to_be_bytes());
    ihdr.extend_from_slice(&[8, 6, 0, 0, 0]);
    chunk(&mut png, b"IHDR", &ihdr);
    chunk(&mut png, b"IDAT", &miniz_oxide::deflate::compress_to_vec_zlib(&raw, 6));
    chunk(&mut png, b"IEND", &[]);
    png
}

fn chunk(png: &mut Vec<u8>, kind: &[u8; 4], data: &[u8]) {
    png.extend_from_slice(&(data.len() as u32).to_be_bytes());
    let mut crc = crc32fast::Hasher::new();
    crc.update(kind);
    crc.update(data);
    png.extend_from_slice(kind);
    png.extend_from_slice(data);
    png.extend_from_slice(&crc.finalize().to_be_bytes());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_cube_draws_in_the_middle_and_leaves_the_corners_clear() {
        let v = |x: f32, y: f32, z: f32| [x, y, z];
        let vertices = vec![
            v(0., 0., 0.),
            v(10., 0., 0.),
            v(10., 10., 0.),
            v(0., 10., 0.),
            v(0., 0., 10.),
            v(10., 0., 10.),
            v(10., 10., 10.),
            v(0., 10., 10.),
        ];
        let triangles = vec![
            [0, 2, 1],
            [0, 3, 2],
            [4, 5, 6],
            [4, 6, 7],
            [0, 1, 5],
            [0, 5, 4],
            [1, 2, 6],
            [1, 6, 5],
            [2, 3, 7],
            [2, 7, 6],
            [3, 0, 4],
            [3, 4, 7],
        ];
        let cube = Mesh { name: "cube".into(), vertices, triangles };
        let pixels = render(&[cube], 64, "#F2754E");
        let alpha = |x: usize, y: usize| pixels[(y * 64 + x) * 4 + 3];
        assert_eq!(alpha(32, 32), 255);
        assert_eq!(alpha(0, 0), 0);
        let png = encode(&pixels, 64, 64);
        assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
    }
}
