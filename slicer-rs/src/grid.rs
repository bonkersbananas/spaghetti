//! Orca's support grid (`SupportGridPattern`, its "grid" style, which every support but snug supports takes): the
//! areas to support are drawn onto pixels a seventh of the support's line spacing wide, as Orca draws them with
//! AGG's anti-aliasing rasteriser (`rasterize_polygons`), and every 7×7 block of pixels is filled from them as far
//! as the object, eroded by a pixel, lets it (`seed_fill_block`). The pixels are then traced back into outlines
//! (`contours_simplified`), moved out or in by a hair, cut by the object and kept where they hold some of what was
//! asked for (`extract_support`). So support columns snap to a grid fixed to the object and stop short of it.
//!
//! The raster works in Orca's nanometres: a pixel is 411 011.37 nm and the grid steps 2 877 079 nm, which are not
//! whole numbers of our units, and a pixel more or less moves a column's edge by 0.4 mm.

use crate::geom::{self, Contour, Shapes};

/// Nanometres in one of our units.
const NM: f64 = 100.0;

/// What the grid is built from: the support's line spacing and the spacing of its columns (mm), and where the
/// object's frame has its origin (nm on the plate: the middle of its bounding box, which Orca's grid is aligned to).
#[derive(Clone, Copy, Debug)]
pub struct Params {
    /// `support_base_pattern_spacing` plus the support line's spacing (Orca's `grid_resolution`), mm.
    pub resolution: f64,
    /// The support line's spacing, mm (Orca's `extrusion_width` for the grid).
    pub line_spacing: f64,
    pub origin: (i64, i64),
}

impl Params {
    /// How far the outlines are moved out to slice support from them (`expansion_to_slice`): half a support line
    /// and a hair, nm.
    pub fn expansion_to_slice(&self) -> i64 {
        // `coord_t(scaled_spacing() / 2 + 5)`, with Orca's integer scaled spacing.
        (self.line_spacing * 1e6) as i64 / 2 + 5
    }
}

/// How far the outlines are moved in to project support down (`expansion_to_propagate`), nm.
pub const EXPANSION_TO_PROPAGATE: i64 = -3;

pub struct Grid<'a> {
    support: &'a Shapes,
    trimming: &'a Shapes,
    /// nm: the corner of pixel (0, 0).
    min: (i64, i64),
    pixel: f64,
    size: (usize, usize),
    cells: Vec<u8>,
}

impl<'a> Grid<'a> {
    /// The support areas `support` drawn on the grid and spread over its blocks up to `trimming`.
    pub fn new(support: &'a Shapes, trimming: &'a Shapes, p: &Params) -> Grid<'a> {
        let resolution = (p.resolution * 1e6) as i64;
        // The support's bounding box, 20 nm wider, its corner on the grid (an empty support gives Orca's undefined
        // box at the origin, which yields nothing).
        let (mut min, max) = match geom::bbox(support) {
            Some(b) => (
                ((b[0] as i64) * NM as i64 - 20, (b[1] as i64) * NM as i64 - 20),
                ((b[2] as i64) * NM as i64 + 20, (b[3] as i64) * NM as i64 + 20),
            ),
            None => ((0, 0), (0, 0)),
        };
        let align = |v: i64, base: i64| base + (v - base).div_euclid(resolution) * resolution;
        min = (align(min.0, p.origin.0), align(min.1, p.origin.1));
        let spacing_scaled = (p.line_spacing * 1e6) as i64;
        let oversampling = ((p.resolution * 1e6 / (spacing_scaled + 100) as f64) as i32).clamp(1, 8) as usize;
        let pixel = ((spacing_scaled + 21) as f64).max(p.resolution * 1e6 / oversampling as f64);
        // One empty pixel round it (Orca's `BoundingBox::offset` rounds the pixel to a whole nanometre).
        let grow = pixel.round() as i64;
        let (min, max) = ((min.0 - grow, min.1 - grow), (max.0 + grow, max.1 + grow));
        let raw = (((max.0 - min.0) as f64 / pixel).ceil() as usize, ((max.1 - min.1) as f64 / pixel).ceil() as usize);
        let blocks = (
            (raw.0 + oversampling - 1).saturating_sub(2) / oversampling,
            (raw.1 + oversampling - 1).saturating_sub(2) / oversampling,
        );
        let size = (blocks.0 * oversampling + 2, blocks.1 * oversampling + 2);
        let mut cells = rasterize(size, pixel, min, support);
        let mask = erode(&rasterize(size, pixel, min, trimming), size);
        seed_fill(&mut cells, size, &mask, blocks, oversampling);
        Grid { support, trimming, min, pixel, size, cells }
    }

    /// The grid's areas as outlines moved out by `offset` nm (in by a negative one), with cells between two set
    /// ones set first if `fill_holes`; cut by the trimming areas, each piece kept if it holds some of the support
    /// it was drawn from.
    pub fn extract(&self, offset: i64, fill_holes: bool) -> Shapes {
        let contours = self.contours(offset, fill_holes);
        if contours.is_empty() {
            return Vec::new();
        }
        let simplified = geom::union_contours(&contours);
        let islands = geom::difference(&simplified, self.trimming);
        // Orca keeps an island if one of up to four points sampled on each support area lies in it: the island
        // that holds the area. An island that holds none of the support is a stretch of grid cut off by the object.
        islands
            .into_iter()
            .filter(|island| {
                let b = geom::bbox_of(island);
                let near = geom::near(self.support, b);
                !near.is_empty() && !geom::intersection(&vec![island.clone()], &near).is_empty()
            })
            .collect()
    }

    /// Orca's `contours_simplified`: the outlines of the set cells, corners only, back on the plate.
    fn contours(&self, offset: i64, fill_holes: bool) -> Vec<Contour> {
        let (w, h) = self.size;
        let filled;
        let inside: &[u8] = if fill_holes {
            let mut copy = self.cells.clone();
            for r in 1..h.saturating_sub(1) {
                for c in 1..w - 1 {
                    let a = r * w + c;
                    let g = &self.cells;
                    if (g[a - 1] != 0 && g[a + 1] != 0) || (g[a - w] != 0 && g[a + w] != 0) {
                        copy[a] = 1;
                    }
                }
            }
            filled = copy;
            &filled
        } else {
            &self.cells
        };
        // Edges between set and unset cells, the set cell on the right going along (clockwise round what is set).
        let mut lines: Vec<((i64, i64), (i64, i64))> = Vec::new();
        for r in 1..h {
            for c in 1..w {
                let a = r * w + c;
                let (left, below, here) = (inside[a - 1] != 0, inside[a - w] != 0, inside[a] != 0);
                let (c, r) = (c as i64, r as i64);
                if left != here {
                    lines.push(if left { ((c, r + 1), (c, r)) } else { ((c, r), (c, r + 1)) });
                }
                if below != here {
                    lines.push(if below { ((c, r), (c + 1, r)) } else { ((c + 1, r), (c, r)) });
                }
            }
        }
        let mut by_start: Vec<((i64, i64), usize)> = lines.iter().enumerate().map(|(i, l)| (l.0, i)).collect();
        by_start.sort_by_key(|a| a.0);
        let mut done = vec![false; lines.len()];
        let mut out: Vec<Vec<(i64, i64)>> = Vec::new();
        for first in 0..lines.len() {
            if done[first] {
                continue;
            }
            done[first] = true;
            let mut poly = vec![lines[first].1];
            let mut current = first;
            'chain: loop {
                let at = lines[current].1;
                let lo = by_start.partition_point(|e| e.0 < at);
                let mut next: Option<usize> = None;
                for &(start, k) in &by_start[lo..] {
                    if start != at {
                        break;
                    }
                    if k == first {
                        break 'chain;
                    }
                    if done[k] {
                        continue;
                    }
                    match next {
                        None => next = Some(k),
                        Some(_) => {
                            // Two cells meeting at a corner: take the left turn, which joins them.
                            let v1 = (lines[current].1.0 - lines[current].0.0, lines[current].1.1 - lines[current].0.1);
                            let v2 = (lines[k].1.0 - lines[k].0.0, lines[k].1.1 - lines[k].0.1);
                            if v1.0 * v2.1 - v2.0 * v1.1 > 0 {
                                next = Some(k);
                                break;
                            }
                        }
                    }
                }
                let Some(k) = next else { break };
                done[k] = true;
                current = k;
                poly.push(lines[k].1);
            }
            out.push(poly);
        }
        // Back onto the plate, corners only, each moved by `offset` away from what is set.
        let mut contours = Vec::with_capacity(out.len());
        for poly in out {
            let n = poly.len();
            let world: Vec<(i64, i64)> = poly
                .iter()
                .map(|&(c, r)| {
                    ((c as f64 * self.pixel) as i64 + self.min.0, (r as f64 * self.pixel) as i64 + self.min.1)
                })
                .collect();
            let mut pts: Contour = Vec::with_capacity(n);
            for j in 0..n {
                let (j0, j2) = ((j + n - 1) % n, (j + 1) % n);
                let v = (world[j2].0 - world[j0].0, world[j2].1 - world[j0].1);
                if v.0 != 0 && v.1 != 0 {
                    let mut p = world[j];
                    p.1 += if v.0 < 0 { -offset } else { offset };
                    p.0 += if v.1 > 0 { -offset } else { offset };
                    pts.push(geom::pt((p.0 as f64 / NM).round() as i32, (p.1 as f64 / NM).round() as i32));
                }
            }
            // Traced clockwise round what is set: turned round, as our outlines run.
            pts.reverse();
            if pts.len() >= 3 {
                contours.push(pts);
            }
        }
        contours
    }
}

/// The pixels the shapes cover, as AGG's scanline rasteriser draws them at full strength (Orca's
/// `rasterize_polygons`, its gray8 buffer non-zero): every pixel the shapes' area reaches into, with corners
/// rounded to 1/256 of a pixel, the non-zero rule and AGG's integer cell arithmetic.
fn rasterize(size: (usize, usize), pixel: f64, min: (i64, i64), shapes: &Shapes) -> Vec<u8> {
    let (w, h) = size;
    let mut out = vec![0u8; w * h];
    if shapes.is_empty() || w == 0 || h == 0 {
        return out;
    }
    let mut cells = Cells::default();
    let up = |v: f64| -> i32 {
        let s = v * 256.0;
        (if s < 0.0 { s - 0.5 } else { s + 0.5 }) as i32
    };
    for shape in shapes {
        for contour in shape {
            if contour.is_empty() {
                continue;
            }
            let conv = |q: geom::Pt| {
                let (x, y) = (q.x as f64 * NM - min.0 as f64, q.y as f64 * NM - min.1 as f64);
                (up(x / pixel), up(y / pixel))
            };
            let start = conv(contour[0]);
            let mut prev = start;
            for &q in &contour[1..] {
                let p = conv(q);
                cells.line(prev.0, prev.1, p.0, p.1);
                prev = p;
            }
            cells.line(prev.0, prev.1, start.0, start.1);
            // AGG closes the polygon again at the next move: a line of no length, which only moves the cell.
            cells.line(start.0, start.1, start.0, start.1);
        }
    }
    cells.flush();
    let mut list = cells.cells;
    list.sort_unstable_by_key(|c| (c.y, c.x));
    let mut i = 0;
    while i < list.len() {
        let y = list[i].y;
        let mut end = i;
        while end < list.len() && list[end].y == y {
            end += 1;
        }
        let row = &list[i..end];
        i = end;
        let mut set = |x: i32, len: i32| {
            if y < 0 || y as usize >= h {
                return;
            }
            let base = y as usize * w;
            for xx in x.max(0)..(x + len).min(w as i32) {
                out[base + xx as usize] = 1;
            }
        };
        let mut cover = 0i32;
        let mut k = 0;
        while k < row.len() {
            let mut x = row[k].x;
            let mut area = row[k].area;
            cover += row[k].cover;
            k += 1;
            while k < row.len() && row[k].x == x {
                area += row[k].area;
                cover += row[k].cover;
                k += 1;
            }
            if area != 0 {
                if alpha((cover << 9) - area) {
                    set(x, 1);
                }
                x += 1;
            }
            if k < row.len() && row[k].x > x && alpha(cover << 9) {
                set(x, row[k].x - x);
            }
        }
    }
    out
}

/// Whether AGG's `calculate_alpha` gives the area any coverage (its shift rounds down, so any negative area does).
fn alpha(area: i32) -> bool {
    (area >> 9) != 0
}

#[derive(Clone, Copy, Default)]
struct Cell {
    x: i32,
    y: i32,
    cover: i32,
    area: i32,
}

/// AGG's `rasterizer_cells_aa`: the cells each line crosses, with the cover and area it adds to them.
struct Cells {
    cells: Vec<Cell>,
    cur: Cell,
}

impl Default for Cells {
    fn default() -> Self {
        Cells { cells: Vec::new(), cur: Cell { x: i32::MAX, y: i32::MAX, cover: 0, area: 0 } }
    }
}

impl Cells {
    fn set_cell(&mut self, x: i32, y: i32) {
        if self.cur.x != x || self.cur.y != y {
            self.flush();
            self.cur = Cell { x, y, cover: 0, area: 0 };
        }
    }

    fn flush(&mut self) {
        if self.cur.area != 0 || self.cur.cover != 0 {
            self.cells.push(self.cur);
            self.cur.area = 0;
            self.cur.cover = 0;
        }
    }

    fn hline(&mut self, ey: i32, x1: i32, y1: i32, x2: i32, y2: i32) {
        let (mut ex1, ex2) = (x1 >> 8, x2 >> 8);
        let (fx1, fx2) = (x1 & 255, x2 & 255);
        if y1 == y2 {
            self.set_cell(ex2, ey);
            return;
        }
        if ex1 == ex2 {
            let delta = y2 - y1;
            self.cur.cover += delta;
            self.cur.area += (fx1 + fx2) * delta;
            return;
        }
        let mut p = (256 - fx1) as i64 * (y2 - y1) as i64;
        let mut first = 256;
        let mut incr = 1;
        let mut dx = x2 as i64 - x1 as i64;
        if dx < 0 {
            p = fx1 as i64 * (y2 - y1) as i64;
            first = 0;
            incr = -1;
            dx = -dx;
        }
        let mut delta = (p / dx) as i32;
        let mut m = (p % dx) as i32;
        if m < 0 {
            delta -= 1;
            m += dx as i32;
        }
        self.cur.cover += delta;
        self.cur.area += (fx1 + first) * delta;
        ex1 += incr;
        self.set_cell(ex1, ey);
        let mut y1 = y1 + delta;
        if ex1 != ex2 {
            let p = 256i64 * (y2 - y1 + delta) as i64;
            let mut lift = (p / dx) as i32;
            let mut rem = (p % dx) as i32;
            if rem < 0 {
                lift -= 1;
                rem += dx as i32;
            }
            m -= dx as i32;
            while ex1 != ex2 {
                delta = lift;
                m += rem;
                if m >= 0 {
                    m -= dx as i32;
                    delta += 1;
                }
                self.cur.cover += delta;
                self.cur.area += 256 * delta;
                y1 += delta;
                ex1 += incr;
                self.set_cell(ex1, ey);
            }
        }
        let delta = y2 - y1;
        self.cur.cover += delta;
        self.cur.area += (fx2 + 256 - first) * delta;
    }

    fn line(&mut self, x1: i32, y1: i32, x2: i32, y2: i32) {
        let dx = x2 as i64 - x1 as i64;
        let dy0 = y2 as i64 - y1 as i64;
        let (ex1, ey1, ey2) = (x1 >> 8, y1 >> 8, y2 >> 8);
        let (fy1, fy2) = (y1 & 255, y2 & 255);
        self.set_cell(ex1, ey1);
        if ey1 == ey2 {
            self.hline(ey1, x1, fy1, x2, fy2);
            return;
        }
        let mut incr = 1;
        if dx == 0 {
            let ex = x1 >> 8;
            let two_fx = (x1 - (ex << 8)) << 1;
            let mut first = 256;
            if dy0 < 0 {
                first = 0;
                incr = -1;
            }
            let delta = first - fy1;
            self.cur.cover += delta;
            self.cur.area += two_fx * delta;
            let mut ey = ey1 + incr;
            self.set_cell(ex, ey);
            let delta = first + first - 256;
            let area = two_fx * delta;
            while ey != ey2 {
                self.cur.cover = delta;
                self.cur.area = area;
                ey += incr;
                self.set_cell(ex, ey);
            }
            let delta = fy2 - 256 + first;
            self.cur.cover += delta;
            self.cur.area += two_fx * delta;
            return;
        }
        let mut p = (256 - fy1) as i64 * dx;
        let mut first = 256;
        let mut dy = dy0;
        if dy < 0 {
            p = fy1 as i64 * dx;
            first = 0;
            incr = -1;
            dy = -dy;
        }
        let mut delta = (p / dy) as i32;
        let mut m = (p % dy) as i32;
        if m < 0 {
            delta -= 1;
            m += dy as i32;
        }
        let mut x_from = x1 + delta;
        self.hline(ey1, x1, fy1, x_from, first);
        let mut ey = ey1 + incr;
        self.set_cell(x_from >> 8, ey);
        if ey != ey2 {
            let p = 256 * dx;
            let mut lift = (p / dy) as i32;
            let mut rem = (p % dy) as i32;
            if rem < 0 {
                lift -= 1;
                rem += dy as i32;
            }
            m -= dy as i32;
            while ey != ey2 {
                delta = lift;
                m += rem;
                if m >= 0 {
                    m -= dy as i32;
                    delta += 1;
                }
                let x_to = x_from + delta;
                self.hline(ey, x_from, 256 - first, x_to, first);
                x_from = x_to;
                ey += incr;
                self.set_cell(x_from >> 8, ey);
            }
        }
        self.hline(ey, x_from, 256 - first, x2, fy2);
    }
}

/// Orca's `dilate_trimming_region`, which erodes: a pixel stays masked only if all nine round it are, and the
/// border is never masked.
fn erode(mask: &[u8], (w, h): (usize, usize)) -> Vec<u8> {
    let mut out = vec![0u8; mask.len()];
    for r in 1..h.saturating_sub(1) {
        for c in 1..w.saturating_sub(1) {
            let all = (r - 1..=r + 1).all(|rr| (c - 1..=c + 1).all(|cc| mask[rr * w + cc] != 0));
            out[r * w + c] = all as u8;
        }
    }
    out
}

/// Orca's `seed_fill_block`: within each block, support spreads to the next pixel up, down, left and right (in
/// this fixed order of sweeps, not to a full flood fill), never into or out of a masked pixel.
fn seed_fill(grid: &mut [u8], (w, _h): (usize, usize), mask: &[u8], blocks: (usize, usize), size: usize) {
    let stride = w as isize;
    for br in 0..blocks.1 {
        for bc in 0..blocks.0 {
            let base = (bc * size + 1) as isize + ((br * size + 1) as isize) * stride;
            let mut step = |r: usize, c: usize, offset: isize| {
                let a = base + r as isize * stride + c as isize;
                let a2 = a + offset;
                if grid[a2 as usize] != 0 && mask[a as usize] == 0 && mask[a2 as usize] == 0 {
                    grid[a as usize] = 1;
                }
            };
            for r in 0..size {
                if r > 0 {
                    for c in 0..size {
                        step(r, c, -stride);
                    }
                }
                for c in 1..size {
                    step(r, c, -1);
                }
                for c in (0..size - 1).rev() {
                    step(r, c, 1);
                }
            }
            for r in (0..size - 1).rev() {
                for c in 0..size {
                    step(r, c, stride);
                }
                for c in 1..size {
                    step(r, c, -1);
                }
                for c in (0..size - 1).rev() {
                    step(r, c, 1);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn square(x0: f64, y0: f64, x1: f64, y1: f64) -> Shapes {
        vec![vec![vec![
            geom::pt(geom::sc(x0), geom::sc(y0)),
            geom::pt(geom::sc(x1), geom::sc(y0)),
            geom::pt(geom::sc(x1), geom::sc(y1)),
            geom::pt(geom::sc(x0), geom::sc(y1)),
        ]]]
    }

    fn params() -> Params {
        Params { resolution: 2.5 + 0.377_079_606_056_213_4, line_spacing: 0.377_079_606_056_213_4, origin: (0, 0) }
    }

    #[test]
    fn a_pixel_any_part_of_a_shape_reaches_into_is_set() {
        // A unit square at (0.1, 0.1) to (2.9, 0.6) in pixels: rows 0, columns 0..2 set.
        let size = (5, 3);
        let pixel = 1_000_000.0;
        let shapes = square(0.1, 0.1, 2.9, 0.6);
        let out = rasterize(size, pixel, (0, 0), &shapes);
        assert_eq!(&out[0..5], &[1, 1, 1, 0, 0]);
        assert!(out[5..].iter().all(|&v| v == 0));
        // Edges on pixel borders leave the neighbours alone.
        let out = rasterize(size, pixel, (0, 0), &square(1.0, 1.0, 3.0, 2.0));
        assert_eq!(&out[5..10], &[0, 1, 1, 0, 0]);
        assert!(out[0..5].iter().all(|&v| v == 0) && out[10..].iter().all(|&v| v == 0));
    }

    #[test]
    fn support_snaps_to_whole_blocks_of_the_grid_up_to_the_object() {
        // A small spot to support beside an object: it grows to the grid's 2.88 mm blocks but not into the object.
        let spot = square(10.0, 10.0, 10.5, 10.5);
        let object = square(11.2, 0.0, 30.0, 30.0);
        let grid = Grid::new(&spot, &object, &params());
        let out = grid.extract(params().expansion_to_slice(), true);
        assert_eq!(out.len(), 1);
        let b = geom::bbox(&out).unwrap().map(geom::unsc);
        // The block holding the spot: 8.63 to 11.51 mm on the grid through the origin (the object, a pixel and a bit
        // in, masks none of it), the outline moved out by half a line, then cut at the object.
        assert!((b[0] - (8.631_237 - 0.188_544)).abs() < 2e-4, "{b:?}");
        assert!((b[2] - 11.2).abs() < 2e-4, "{b:?}");
        assert!((b[1] - b[0]).abs() < 2e-4 && (b[3] - (8.631_237 + 2.877_079 + 0.188_544)).abs() < 2e-4, "{b:?}");
        assert!(geom::intersection(&out, &object).is_empty());
    }
}
