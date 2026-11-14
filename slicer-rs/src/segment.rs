//! An object's layers split by its painted colours, as Orca 2.5 splits them (MultiMaterialSegmentation.cpp,
//! `segmentation_by_painting`): each painted triangle cut by every layer it crosses is projected onto the layer's
//! outline (the contour segments it runs along, found through Orca's EdgeGrid), the outline is coloured by what was
//! projected onto it, and each island whose outline has more than one colour is split between them along its
//! Voronoi graph; an island in one colour is that colour's whole. Orca's tolerances are in nanometres, ours in our
//! 0.1 µm units: its `SCALED_EPSILON` (100 nm) is one of them.

use crate::geom::{self, Pt, Shape, Shapes};

/// A point in our units, wide enough for the products the tests take.
pub(crate) type P = [i64; 2];

/// Orca's `SCALED_EPSILON` (100 nm), in our units.
const SCALED_EPSILON: i64 = 1;

/// Orca's `scale_`: mm to our units.
fn scaled(mm: f64) -> f64 {
    mm * geom::SCALE
}

fn p(pt: &Pt) -> P {
    [i64::from(pt.x), i64::from(pt.y)]
}

fn sub(a: P, b: P) -> [f64; 2] {
    [(a[0] - b[0]) as f64, (a[1] - b[1]) as f64]
}

fn dot(a: [f64; 2], b: [f64; 2]) -> f64 {
    a[0] * b[0] + a[1] * b[1]
}

fn cross(a: [f64; 2], b: [f64; 2]) -> f64 {
    a[0] * b[1] - a[1] * b[0]
}

fn norm2(a: [f64; 2]) -> f64 {
    dot(a, a)
}

/// A segment, as Orca's `Line`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Line {
    pub a: P,
    pub b: P,
}

impl Line {
    fn new(a: P, b: P) -> Line {
        Line { a, b }
    }

    fn vector(&self) -> [f64; 2] {
        sub(self.b, self.a)
    }

    fn length(&self) -> f64 {
        norm2(self.vector()).sqrt()
    }

    fn reverse(&mut self) {
        std::mem::swap(&mut self.a, &mut self.b);
    }

    /// `line_alg::distance_to_squared`: to the nearest point of the segment.
    fn distance_to_squared(&self, point: P) -> f64 {
        let v = self.vector();
        let va = sub(point, self.a);
        let l2 = norm2(v);
        if l2 == 0.0 {
            return norm2(va);
        }
        let t = dot(va, v) / l2;
        if t <= 0.0 {
            norm2(va)
        } else if t >= 1.0 {
            norm2(sub(point, self.b))
        } else {
            norm2([t * v[0] - va[0], t * v[1] - va[1]])
        }
    }

    /// `line_alg::intersection`: where the two segments cross (ends included), truncated to a point.
    fn intersection(&self, other: &Line) -> Option<P> {
        let v1 = self.vector();
        let v2 = other.vector();
        let denom = cross(v1, v2);
        if denom.abs() < 1e-4 {
            return None;
        }
        let v12 = sub(self.a, other.a);
        let t1 = cross(v2, v12) / denom;
        let t2 = cross(v1, v12) / denom;
        (0.0..=1.0).contains(&t1).then_some(())?;
        (0.0..=1.0).contains(&t2).then_some(())?;
        Some([(self.a[0] as f64 + t1 * v1[0]) as i64, (self.a[1] as f64 + t1 * v1[1]) as i64])
    }

    /// `Line::extend`: both ends pushed out by `offset` along the line (truncated).
    fn extend(&mut self, offset: f64) {
        let v = self.vector();
        let l = norm2(v).sqrt();
        let o = if l == 0.0 { [0, 0] } else { [(offset * v[0] / l) as i64, (offset * v[1] / l) as i64] };
        self.a = [self.a[0] - o[0], self.a[1] - o[1]];
        self.b = [self.b[0] + o[0], self.b[1] + o[1]];
    }

    /// `Line::clip_with_bbox` (Liang–Barsky), its ends truncated; false where the line misses the box.
    fn clip_with_bbox(&mut self, b: [i64; 4]) -> bool {
        let (x0, y0) = (self.a[0] as f64, self.a[1] as f64);
        let (dx, dy) = (self.b[0] as f64 - x0, self.b[1] as f64 - y0);
        let (mut t0, mut t1) = (0.0f64, 1.0f64);
        for (pk, qk) in
            [(-dx, x0 - b[0] as f64), (dx, b[2] as f64 - x0), (-dy, y0 - b[1] as f64), (dy, b[3] as f64 - y0)]
        {
            if pk == 0.0 {
                if qk < 0.0 {
                    return false;
                }
            } else {
                let r = qk / pk;
                if pk < 0.0 {
                    if r > t1 {
                        return false;
                    }
                    t0 = t0.max(r);
                } else {
                    if r < t0 {
                        return false;
                    }
                    t1 = t1.min(r);
                }
            }
        }
        let at = |t: f64| [(x0 + t * dx) as i64, (y0 + t * dy) as i64];
        (self.a, self.b) = (at(t0), at(t1));
        true
    }
}

/// `project_line_on_line`: `projected` dropped onto `onto`, its ends clamped to it and truncated to points.
fn project_line_on_line(onto: &Line, projected: &Line) -> Option<Line> {
    let v1 = onto.vector();
    let l2 = norm2(v1);
    if l2 == 0.0 {
        return None;
    }
    let t1 = (dot(sub(projected.a, onto.a), v1) / l2).clamp(0.0, 1.0);
    let t2 = (dot(sub(projected.b, onto.a), v1) / l2).clamp(0.0, 1.0);
    let at = |t: f64| [onto.a[0] + (t * v1[0]) as i64, onto.a[1] + (t * v1[1]) as i64];
    Some(Line::new(at(t1), at(t2)))
}

// ---------------------------------------------------------------------------------------------------------------
// The layer's outline, as the segmentation takes it.

/// `segmentation_by_painting`'s input: a layer's shapes (all its regions) grown by 1 µm, merged, rid of islands and
/// holes under 0.01 mm², shrunk back, simplified to 0.5 µm and rid of points within 10 µm of the one before that
/// barely turn (`remove_duplicates`, 30°).
pub fn outline(shapes: &Shapes) -> Shapes {
    let grown = geom::offset_c2(shapes, 10.0 / geom::SCALE, geom::Join::Miter(3.0));
    let min_area = scaled(0.1) * scaled(0.1);
    let mut kept: Shapes = Vec::new();
    for shape in grown {
        let Some(contour) = shape.first() else { continue };
        if (geom::area2(contour) as f64 / 2.0).abs() < min_area {
            continue;
        }
        let mut s = vec![contour.clone()];
        s.extend(shape[1..].iter().filter(|h| (geom::area2(h) as f64 / 2.0).abs() >= min_area).cloned());
        kept.push(s);
    }
    let shrunk = geom::offset_c2(&kept, -10.0 / geom::SCALE, geom::Join::Miter(3.0));
    let simple = geom::simplify_polygons(&shrunk, 5.0 / geom::SCALE);
    let mut out = Vec::new();
    for shape in simple {
        let mut contours = shape.into_iter().map(|c| remove_duplicates(c, 100, std::f64::consts::PI / 6.0));
        let Some(contour) = contours.next().filter(|c| !c.is_empty()) else { continue };
        let mut s = vec![contour];
        s.extend(contours.filter(|c| !c.is_empty()));
        out.push(s);
    }
    out
}

/// Orca's `remove_duplicates(MutablePolygon, scaled_eps, max_angle)`: each point after the first, round the loop,
/// goes where it lies within `eps` of the one before and the turn it makes from there to the next is under
/// `max_angle`; a loop left with fewer than three points goes.
fn remove_duplicates(contour: Vec<Pt>, eps: i64, max_angle: f64) -> Vec<Pt> {
    if contour.len() < 3 {
        return Vec::new();
    }
    let cos2 = max_angle.cos().powi(2);
    // A ring: each point's next and previous, the first never removed (the walk ends there).
    let n = contour.len();
    let mut next: Vec<usize> = (0..n).map(|i| (i + 1) % n).collect();
    let mut prev: Vec<usize> = (0..n).map(|i| (i + n - 1) % n).collect();
    let mut alive = n;
    let mut it = next[0];
    while it != 0 && alive >= 3 {
        let (pv, nx) = (prev[it], next[it]);
        let v1 = [i64::from(contour[it].x - contour[pv].x), i64::from(contour[it].y - contour[pv].y)];
        let v1n = v1[0] * v1[0] + v1[1] * v1[1];
        if v1n < eps * eps {
            let v2 = [i64::from(contour[nx].x - contour[pv].x), i64::from(contour[nx].y - contour[pv].y)];
            let d = (v1[0] * v2[0] + v1[1] * v2[1]) as f64;
            if d * d > cos2 * v1n as f64 * (v2[0] * v2[0] + v2[1] * v2[1]) as f64 {
                next[pv] = nx;
                prev[nx] = pv;
                alive -= 1;
                it = nx;
                continue;
            }
        }
        it = nx;
    }
    if alive < 3 {
        return Vec::new();
    }
    let mut out = Vec::with_capacity(alive);
    let mut i = 0;
    loop {
        out.push(contour[i]);
        i = next[i];
        if i == 0 {
            break;
        }
    }
    out
}

// ---------------------------------------------------------------------------------------------------------------
// Orca's EdgeGrid: the outline's segments filed under the 10 mm cells they cross.

pub(crate) struct Grid {
    /// The grid's box (min x, min y, max x, max y).
    pub bbox: [i64; 4],
    resolution: i64,
    rows: i64,
    cols: i64,
    /// Each cell's range in `cell_data`.
    cells: Vec<(u32, u32)>,
    cell_data: Vec<(u32, u32)>,
    /// The outline's loops, in the order of its islands (an island's contour, then its holes).
    pub contours: Vec<Vec<P>>,
}

impl Grid {
    /// `set_bbox(bbox)` then `create(islands, resolution)`.
    pub fn new(bbox: [i64; 4], islands: &Shapes, resolution: i64) -> Grid {
        let contours: Vec<Vec<P>> = islands
            .iter()
            .flat_map(|s| s.iter())
            .filter(|c| !c.is_empty())
            .map(|c| c.iter().map(p).collect())
            .collect();
        let mut b = bbox;
        for c in &contours {
            for q in c {
                b = [b[0].min(q[0]), b[1].min(q[1]), b[2].max(q[0]), b[3].max(q[1])];
            }
        }
        // Orca's 16 nm, rounded up to one of our units.
        let eps = 1;
        b = [b[0] - eps, b[1] - eps, b[2] + eps, b[3] + eps];
        let cols = (b[2] - b[0] + resolution - 1) / resolution;
        let rows = (b[3] - b[1] + resolution - 1) / resolution;
        let mut grid = Grid { bbox: b, resolution, rows, cols, cells: Vec::new(), cell_data: Vec::new(), contours };
        // Count each cell's segments, then file them, by the same walk.
        let mut count = vec![0u32; (rows * cols) as usize];
        for c in &grid.contours {
            for j in 0..segments(c) {
                grid.walk(c[j], c[(j + 1) % c.len()], &mut |iy, ix| {
                    count[(iy * grid.cols + ix) as usize] += 1;
                    true
                });
            }
        }
        let mut start = 0u32;
        grid.cells = count
            .iter()
            .map(|&k| {
                let r = (start, start);
                start += k;
                r
            })
            .collect();
        let mut data = vec![(0u32, 0u32); start as usize];
        let mut cells = std::mem::take(&mut grid.cells);
        for (i, c) in grid.contours.iter().enumerate() {
            for j in 0..segments(c) {
                grid.walk(c[j], c[(j + 1) % c.len()], &mut |iy, ix| {
                    let cell = &mut cells[(iy * grid.cols + ix) as usize];
                    data[cell.1 as usize] = (i as u32, j as u32);
                    cell.1 += 1;
                    true
                });
            }
        }
        grid.cells = cells;
        grid.cell_data = data;
        grid
    }

    fn line(&self, (contour, segment): (u32, u32)) -> Line {
        let c = &self.contours[contour as usize];
        Line::new(c[segment as usize], c[(segment as usize + 1) % c.len()])
    }

    /// `visit_cells_intersecting_line`: each cell the segment from `p1` to `p2` passes through, in order, until the
    /// visitor says stop. Both ends must lie in the grid's box.
    pub fn walk(&self, p1: P, p2: P, visitor: &mut impl FnMut(i64, i64) -> bool) {
        let r = self.resolution;
        let p1 = [p1[0] - self.bbox[0], p1[1] - self.bbox[1]];
        let p2 = [p2[0] - self.bbox[0], p2[1] - self.bbox[1]];
        let (mut ix, mut iy) = (p1[0] / r, p1[1] / r);
        let (ixb, iyb) = (p2[0] / r, p2[1] / r);
        if !visitor(iy, ix) || (ix == ixb && iy == iyb) {
            return;
        }
        let dx = (p2[0] - p1[0]).abs();
        let dy = (p2[1] - p1[1]).abs();
        let inside = |ix: i64, iy: i64| ix >= 0 && iy >= 0 && ix < self.cols && iy < self.rows;
        if p1[0] < p2[0] {
            let mut ex = ((ix + 1) * r - p1[0]) * dy;
            if p1[1] < p2[1] {
                let mut ey = ((iy + 1) * r - p1[1]) * dx;
                loop {
                    if ex < ey {
                        ey -= ex;
                        ex = dy * r;
                        ix += 1;
                    } else if ex == ey {
                        ex = dy * r;
                        ey = dx * r;
                        ix += 1;
                        iy += 1;
                    } else {
                        ex -= ey;
                        ey = dx * r;
                        iy += 1;
                    }
                    if !inside(ix, iy) || !visitor(iy, ix) {
                        return;
                    }
                    if ix == ixb && iy == iyb {
                        return;
                    }
                }
            } else {
                let mut ey = (p1[1] - iy * r) * dx;
                loop {
                    if ex <= ey {
                        ey -= ex;
                        ex = dy * r;
                        ix += 1;
                    } else {
                        ex -= ey;
                        ey = dx * r;
                        iy -= 1;
                    }
                    if !inside(ix, iy) || !visitor(iy, ix) {
                        return;
                    }
                    if ix == ixb && iy == iyb {
                        return;
                    }
                }
            }
        } else {
            let mut ex = (p1[0] - ix * r) * dy;
            if p1[1] < p2[1] {
                let mut ey = ((iy + 1) * r - p1[1]) * dx;
                loop {
                    if ex < ey {
                        ey -= ex;
                        ex = dy * r;
                        ix -= 1;
                    } else {
                        ex -= ey;
                        ey = dx * r;
                        iy += 1;
                    }
                    if !inside(ix, iy) || !visitor(iy, ix) {
                        return;
                    }
                    if ix == ixb && iy == iyb {
                        return;
                    }
                }
            } else {
                let mut ey = (p1[1] - iy * r) * dx;
                loop {
                    if ex < ey {
                        ey -= ex;
                        ex = dy * r;
                        ix -= 1;
                    } else if ex == ey {
                        // The lower edge of a cell belongs to the cell (Orca's comment).
                        if dx > 0 {
                            ex = dy * r;
                            ix -= 1;
                        }
                        if dy > 0 {
                            ey = dx * r;
                            iy -= 1;
                        }
                    } else {
                        ex -= ey;
                        ey = dx * r;
                        iy -= 1;
                    }
                    if !inside(ix, iy) || !visitor(iy, ix) {
                        return;
                    }
                    if ix == ixb && iy == iyb {
                        return;
                    }
                }
            }
        }
    }

    fn cell(&self, iy: i64, ix: i64) -> &[(u32, u32)] {
        let (from, to) = self.cells[(iy * self.cols + ix) as usize];
        &self.cell_data[from as usize..to as usize]
    }
}

/// `EdgeGrid::Contour::num_segments` of a closed loop, but none for a loop of two points or fewer, as its
/// `get_segments` gives none.
fn segments(c: &[P]) -> usize {
    if c.len() > 2 { c.len() } else { 0 }
}

// ---------------------------------------------------------------------------------------------------------------
// Painted lines: a painted triangle's cut through a layer, dropped onto the outline's segments it runs along.

#[derive(Clone, Copy, Debug)]
pub(crate) struct PaintedLine {
    pub contour: u32,
    pub line: u32,
    pub projected: Line,
    pub color: i32,
}

/// Orca's `PaintedLineVisitor` for one painted line: each outline segment in the cells it crosses (walked along
/// `walk`, the line within the grid's box) that runs within 30° of it and comes within 5 µm of it gets the painted
/// line dropped onto it.
pub(crate) fn paint_line(grid: &Grid, line_to_test: Line, walk: Line, color: i32, out: &mut Vec<PaintedLine>) {
    let append_threshold = 50.0 * SCALED_EPSILON as f64;
    let append_threshold2 = append_threshold * append_threshold;
    let cos_threshold2 = (std::f64::consts::PI * 30.0 / 180.0).cos().powi(2);
    let v1 = line_to_test.vector();
    let v1_sqr_norm = norm2(v1);
    let heuristic_thr_part = line_to_test.length() + append_threshold;
    let mut seen: std::collections::HashSet<(u32, u32)> = std::collections::HashSet::new();
    grid.walk(walk.a, walk.b, &mut |iy, ix| {
        for &cs in grid.cell(iy, ix) {
            let grid_line = grid.line(cs);
            let v2 = grid_line.vector();
            let thr = (heuristic_thr_part + grid_line.length()).powi(2);
            if norm2(sub(grid_line.a, line_to_test.a)) > thr
                || norm2(sub(grid_line.b, line_to_test.a)) > thr
                || norm2(sub(grid_line.a, line_to_test.b)) > thr
                || norm2(sub(grid_line.b, line_to_test.b)) > thr
            {
                continue;
            }
            if dot(v1, v2).powi(2) > cos_threshold2 * v1_sqr_norm * norm2(v2)
                && !seen.contains(&cs)
                && (grid_line.distance_to_squared(line_to_test.a) < append_threshold2
                    || grid_line.distance_to_squared(line_to_test.b) < append_threshold2
                    || line_to_test.distance_to_squared(grid_line.a) < append_threshold2
                    || line_to_test.distance_to_squared(grid_line.b) < append_threshold2)
            {
                let Some(mut projected) = project_line_on_line(&grid_line, &line_to_test) else { continue };
                if norm2(sub(projected.a, grid_line.a)) > norm2(sub(projected.b, grid_line.a)) {
                    projected.reverse();
                }
                seen.insert(cs);
                out.push(PaintedLine { contour: cs.0, line: cs.1, projected, color });
            }
        }
        true
    });
}

/// A painted triangle (its corners in mm, as Orca transforms them, in floats) cut by each layer it crosses, each cut
/// dropped onto that layer's outline. `slice_z`: each layer's cutting height; `grids`: each layer's outline, None
/// where the layer has none.
pub(crate) fn project_facet(
    facet: [[f32; 3]; 3],
    color: i32,
    slice_z: &[f64],
    grids: &[Option<Grid>],
    painted: &mut [Vec<PaintedLine>],
) {
    let is_equal = |l: f32, r: f32| (l - r).abs() <= 1e-3;
    let is_less = |l: f32, r: f32| l + 1e-3 < r;
    let min_z = facet.iter().map(|v| v[2]).fold(f32::MAX, f32::min);
    let max_z = facet.iter().map(|v| v[2]).fold(f32::MIN, f32::max);
    if is_equal(min_z, max_z) {
        return;
    }
    let mut f = facet;
    // std::sort of three by z: an insertion sort, so stable.
    f.sort_by(|a, b| a[2].partial_cmp(&b[2]).unwrap_or(std::cmp::Ordering::Equal));
    // The lowest layer cut above min_z - EPSILON, and the last at or under max_z + EPSILON (Orca's keys are floats,
    // its layers' heights doubles).
    let below = f64::from((f64::from(min_z) - 1e-4) as f32);
    let above = f64::from((f64::from(max_z) + 1e-4) as f32);
    let first = slice_z.partition_point(|&z| z <= below);
    let end = slice_z.partition_point(|&z| z <= above);
    for layer in first..end {
        let Some(grid) = &grids[layer] else { continue };
        let z = slice_z[layer] as f32;
        if is_less(z, f[0][2]) || is_less(f[2][2], z) {
            continue;
        }
        let lerp = |a: [f32; 3], b: [f32; 3], t: f32| [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
        let t = (z - f[0][2]) / (f[2][2] - f[0][2]);
        let start = lerp(f[0], f[2], t);
        let end_p = if (is_equal(f[0][2], f[1][2]) && is_equal(f[1][2], z))
            || (is_equal(f[1][2], f[2][2]) && is_equal(f[1][2], z))
        {
            [f[1][0], f[1][1]]
        } else if f[1][2] > z {
            lerp(f[0], f[1], (z - f[0][2]) / (f[1][2] - f[0][2]))
        } else {
            lerp(f[1], f[2], (z - f[1][2]) / (f[2][2] - f[1][2]))
        };
        let pt_of = |q: [f32; 2]| {
            [(f64::from(q[0]) * geom::SCALE).round() as i64, (f64::from(q[1]) * geom::SCALE).round() as i64]
        };
        let mut line = Line::new(pt_of(start), pt_of(end_p));
        // A painted line reaching out of the grid's box is clipped to it (10 × Orca's EPSILON beyond it).
        let b = grid.bbox;
        let reach = 10;
        let bb = [b[0] - reach, b[1] - reach, b[2] + reach, b[3] + reach];
        let within = |q: P| q[0] >= bb[0] && q[0] <= bb[2] && q[1] >= bb[1] && q[1] <= bb[3];
        if !within(line.a) || !within(line.b) {
            let lb = [
                line.a[0].min(line.b[0]),
                line.a[1].min(line.b[1]),
                line.a[0].max(line.b[0]),
                line.a[1].max(line.b[1]),
            ];
            let overlap = lb[0] <= bb[2] && lb[2] >= bb[0] && lb[1] <= bb[3] && lb[3] >= bb[1];
            if !overlap || !line.clip_with_bbox(bb) {
                continue;
            }
        }
        // The grid's walk takes ends within its own box (Orca's may stray a micrometre past it).
        let clamp = |q: P| [q[0].clamp(b[0], b[2] - 1), q[1].clamp(b[1], b[3] - 1)];
        let walk = Line::new(clamp(line.a), clamp(line.b));
        paint_line(grid, line, walk, color, &mut painted[layer]);
    }
}

// ---------------------------------------------------------------------------------------------------------------
// The outline coloured by what was painted onto it.

/// `filter_painted_lines`: the painted lines of one outline segment (sorted along it) joined where they meet or
/// overlap in one colour, cut where they overlap in another, and stretched to the segment's ends within 0.1 mm.
fn filter_painted_lines(line_to_process: Line, lines: &[PaintedLine]) -> Vec<PaintedLine> {
    let filter_eps = scaled(0.1) as i64 as f64;
    let mut out = vec![lines[0]];
    for curr in &lines[1..] {
        if out.last().is_some_and(|l| l.projected.b == line_to_process.b) {
            break;
        }
        let prev = *out.last().unwrap();
        let prev_length = prev.projected.length();
        let curr_dist_start = norm2(sub(curr.projected.a, prev.projected.a)).sqrt();
        let dist_between = curr_dist_start - prev_length;
        if dist_between >= 0.0 {
            if prev.color == curr.color {
                if dist_between <= filter_eps {
                    out.last_mut().unwrap().projected.b = curr.projected.b;
                } else {
                    out.push(*curr);
                }
            } else {
                out.push(*curr);
            }
        } else {
            let curr_dist_end = norm2(sub(curr.projected.b, prev.projected.a)).sqrt();
            if curr_dist_end > prev_length {
                if prev.color == curr.color {
                    out.last_mut().unwrap().projected.b = curr.projected.b;
                } else {
                    out.push(PaintedLine {
                        contour: curr.contour,
                        line: curr.line,
                        projected: Line::new(prev.projected.b, curr.projected.b),
                        color: curr.color,
                    });
                }
            }
        }
    }
    if norm2(sub(out[0].projected.a, line_to_process.a)).sqrt() <= filter_eps {
        out[0].projected.a = line_to_process.a;
    }
    let last = out.len() - 1;
    if norm2(sub(out[last].projected.b, line_to_process.b)).sqrt() <= filter_eps {
        out[last].projected.b = line_to_process.b;
    }
    out
}

/// `post_process_painted_lines`: a layer's painted lines in Orca's total order, then filtered segment by segment;
/// each contour's in a list of its own.
pub(crate) fn post_process(contours: &[Vec<P>], mut lines: Vec<PaintedLine>) -> Vec<Vec<PaintedLine>> {
    let mut out = vec![Vec::new(); contours.len()];
    if lines.is_empty() {
        return out;
    }
    let lt = |a: P, b: P| (a[0], a[1]).cmp(&(b[0], b[1]));
    lines.sort_by(|f, s| {
        f.contour
            .cmp(&s.contour)
            .then(f.line.cmp(&s.line))
            .then_with(|| {
                let start = contours[f.contour as usize][f.line as usize];
                let fd = norm2(sub(f.projected.a, start));
                let sd = norm2(sub(s.projected.a, start));
                fd.partial_cmp(&sd).unwrap_or(std::cmp::Ordering::Equal)
            })
            .then_with(|| {
                let fl = norm2(f.projected.vector());
                let sl = norm2(s.projected.vector());
                fl.partial_cmp(&sl).unwrap_or(std::cmp::Ordering::Equal)
            })
            .then(f.color.cmp(&s.color))
            .then(lt(f.projected.a, s.projected.a))
            .then(lt(f.projected.b, s.projected.b))
    });
    let mut from = 0;
    for i in 0..lines.len() {
        let last =
            i + 1 >= lines.len() || lines[i].contour != lines[i + 1].contour || lines[i].line != lines[i + 1].line;
        if last {
            let c = &contours[lines[from].contour as usize];
            let j = lines[from].line as usize;
            let segment = Line::new(c[j], c[(j + 1) % c.len()]);
            out[lines[i].contour as usize].extend(filter_painted_lines(segment, &lines[from..=i]));
            from = i + 1;
        }
    }
    out
}

/// A piece of the outline in a colour (0: unpainted), as Orca's `ColoredLine`, with the loop it is of and its place
/// in it.
#[derive(Clone, Copy, Debug)]
pub(crate) struct ColoredLine {
    pub line: Line,
    pub color: i32,
    pub poly: usize,
    pub local: usize,
}

fn colored(line: Line, color: i32) -> ColoredLine {
    ColoredLine { line, color, poly: 0, local: 0 }
}

/// `colorize_line`: one outline segment cut into its painted and unpainted pieces, with pieces up to 0.2 mm between
/// two of one colour taking it, and up to 0.2 mm at either end joining their neighbour.
fn colorize_line(line_to_process: Line, painted: &[PaintedLine]) -> Vec<ColoredLine> {
    let filter_eps = scaled(0.1) as i64 as f64;
    let mut lines: Vec<ColoredLine> = Vec::new();
    let first = painted[0];
    if norm2(sub(first.projected.a, line_to_process.a)).sqrt() > filter_eps {
        lines.push(colored(Line::new(line_to_process.a, first.projected.a), 0));
    }
    lines.push(colored(first.projected, first.color));
    for curr in &painted[1..] {
        let prev = *lines.last().unwrap();
        let gap = norm2(sub(curr.projected.a, prev.line.b)).sqrt();
        if gap <= filter_eps {
            if prev.color == curr.color {
                lines.last_mut().unwrap().line.b = curr.projected.b;
            } else {
                lines.last_mut().unwrap().line.b = curr.projected.a;
                lines.push(colored(curr.projected, curr.color));
            }
        } else {
            lines.push(colored(Line::new(prev.line.b, curr.projected.a), 0));
            lines.push(colored(curr.projected, curr.color));
        }
    }
    let end = lines.last().unwrap().line.b;
    if norm2(sub(end, line_to_process.b)).sqrt() > filter_eps {
        lines.push(colored(Line::new(end, line_to_process.b), 0));
    }
    let short = scaled(0.2);
    for i in 2..lines.len() {
        if lines[i - 2].color == lines[i].color
            && lines[i - 2].color != lines[i - 1].color
            && lines[i - 1].line.length() <= short
        {
            lines[i - 1].color = lines[i - 2].color;
        }
    }
    let mut simple: Vec<ColoredLine> = vec![lines[0]];
    for l in &lines[1..] {
        if simple.last().unwrap().color == l.color {
            simple.last_mut().unwrap().line.b = l.line.b;
        } else {
            simple.push(*l);
        }
    }
    let mut lines = simple;
    if lines.len() > 1 && lines[0].color != lines[1].color && lines[0].line.length() <= short {
        lines[1].line.a = lines[0].line.a;
        lines.remove(0);
    }
    let n = lines.len();
    if n > 1 && lines[n - 1].color != lines[n - 2].color && lines[n - 1].line.length() <= short {
        lines[n - 2].line.b = lines[n - 1].line.b;
        lines.pop();
    }
    lines
}

/// `get_segments`: a coloured loop's runs of one colour (first and last piece of each, round the loop).
fn runs(lines: &[ColoredLine]) -> Vec<(usize, usize)> {
    let n = lines.len();
    let mut end = 0;
    while end + 1 < n && lines[end].color == lines[end + 1].color {
        end += 1;
    }
    if end == n - 1 {
        return vec![(0, n - 1)];
    }
    let first_different = (end + 1) % n;
    let mut out = Vec::new();
    let mut offset = 0;
    while offset < n {
        let start = (first_different + offset) % n;
        let mut stop = start;
        while offset + 1 < n && lines[start].color == lines[(first_different + offset + 1) % n].color {
            stop = (first_different + offset + 1) % n;
            offset += 1;
        }
        out.push((start, stop));
        offset += 1;
    }
    out
}

/// `filter_colorized_polygon`: short pieces and runs between pieces of one painted colour take it.
fn filter_colorized(mut lines: Vec<ColoredLine>) -> Vec<ColoredLine> {
    let half = scaled(0.5);
    for i in 2..lines.len() {
        let (c0, c1, c2) = (lines[i - 2].color, lines[i - 1].color, lines[i].color);
        if c0 == c2 && c0 != c1 && c0 >= 1 && lines[i - 1].line.length() <= half {
            lines[i - 1].color = c0;
        }
    }
    for i in 3..lines.len() {
        let (c0, c1, c2, c3) = (lines[i - 3].color, lines[i - 2].color, lines[i - 1].color, lines[i].color);
        if c0 == c3
            && (c0 != c1 || c0 != c2)
            && c0 >= 1
            && c3 >= 1
            && lines[i - 2].line.length() + lines[i - 1].line.length() <= half
        {
            lines[i - 2].color = c0;
            lines[i - 1].color = c0;
        }
    }
    let n = lines.len();
    let length = |lines: &[ColoredLine], (from, to): (usize, usize)| {
        let mut total = 0.0;
        let mut i = from;
        while i != to {
            total += lines[i].line.length();
            i = if i + 1 < n { i + 1 } else { 0 };
        }
        total + lines[to].line.length()
    };
    let paint = |lines: &mut [ColoredLine], (from, to): (usize, usize), color: i32| {
        let mut i = from;
        while i != to {
            lines[i].color = color;
            i = if i + 1 < n { i + 1 } else { 0 };
        }
        lines[to].color = color;
    };
    let segs = runs(&lines);
    if segs.len() >= 2 {
        for k in 0..segs.len() {
            let nx = (k + 1) % segs.len();
            let (c0, c1) = (lines[segs[k].0].color, lines[segs[nx].0].color);
            let (l0, l1) = (length(&lines, segs[k]), length(&lines, segs[nx]));
            if c0 != c1 && l0 >= scaled(0.1) && l1 <= scaled(0.2) {
                paint(&mut lines, segs[nx], c0);
            }
        }
    }
    let segs = runs(&lines);
    if segs.len() >= 2 {
        for k in 0..segs.len() {
            let nx = (k + 1) % segs.len();
            let (c0, c1) = (lines[segs[k].0].color, lines[segs[nx].0].color);
            if c0 >= 1 && c0 != c1 && length(&lines, segs[nx]) <= scaled(0.2) {
                paint(&mut lines, segs[nx], c0);
            }
        }
    }
    let segs = runs(&lines);
    if segs.len() >= 3 {
        for k in 0..segs.len() {
            let nx = (k + 1) % segs.len();
            let nn = (nx + 1) % segs.len();
            let (c0, c1, c2) = (lines[segs[k].0].color, lines[segs[nx].0].color, lines[segs[nn].0].color);
            if c0 > 0 && c0 == c2 && c0 != c1 && length(&lines, segs[nx]) <= half {
                paint(&mut lines, segs[nn], c0);
            }
        }
    }
    lines
}

/// `colorize_contour`: a loop's segments coloured by the painted lines on it (unpainted: 0).
fn colorize_contour(contour: &[P], painted: &[PaintedLine]) -> Vec<ColoredLine> {
    let seg = |j: usize| Line::new(contour[j], contour[(j + 1) % contour.len()]);
    let count = segments(contour);
    if painted.is_empty() {
        return (0..count).map(|j| colored(seg(j), 0)).collect();
    }
    let mut out: Vec<ColoredLine> = (0..painted[0].line as usize).map(|j| colored(seg(j), 0)).collect();
    let mut from = 0;
    for i in 0..painted.len() {
        let last = i + 1 >= painted.len() || painted[i].line != painted[i + 1].line;
        if last {
            out.extend(colorize_line(seg(painted[from].line as usize), &painted[from..=i]));
            if i + 1 < painted.len() {
                for j in painted[i].line as usize + 1..painted[i + 1].line as usize {
                    out.push(colored(seg(j), 0));
                }
            }
            from = i + 1;
        }
    }
    for j in painted.last().unwrap().line as usize + 1..count {
        out.push(colored(seg(j), 0));
    }
    filter_colorized(out)
}

/// `colorize_contours`: every loop of the layer coloured, each piece knowing its loop and place.
pub(crate) fn colorize(contours: &[Vec<P>], painted: &[Vec<PaintedLine>]) -> Vec<Vec<ColoredLine>> {
    contours
        .iter()
        .zip(painted)
        .enumerate()
        .map(|(k, (c, lines))| {
            let mut colored = colorize_contour(c, lines);
            for (i, l) in colored.iter_mut().enumerate() {
                l.poly = k;
                l.local = i;
            }
            colored
        })
        .collect()
}

// ---------------------------------------------------------------------------------------------------------------
// An island split by colour along its Voronoi graph (`MMU_Graph`, `build_graph`, `extract_colored_segments`).

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Kind {
    Border,
    NonBorder,
}

#[derive(Clone, Copy, Debug)]
struct Arc {
    from: usize,
    to: usize,
    color: i32,
    kind: Kind,
}

#[derive(Clone, Debug)]
struct Node {
    point: [f64; 2],
    arcs: Vec<usize>,
}

#[derive(Default)]
struct Graph {
    nodes: Vec<Node>,
    arcs: Vec<Arc>,
    /// The nodes before this are the outline's points.
    border: usize,
    offsets: Vec<usize>,
    sizes: Vec<usize>,
}

/// A vertex no node stands for (Orca's colour -1).
const NONE: usize = usize::MAX;

impl Graph {
    fn global(&self, poly: usize, point: usize) -> usize {
        self.offsets[poly] + point
    }

    /// `Node::remove_edge`: the first of the node's arcs to `to` goes.
    fn remove_half(&mut self, from: usize, to: usize) {
        let arcs = &self.arcs;
        if let Some(k) = self.nodes[from].arcs.iter().position(|&a| arcs[a].to == to) {
            self.nodes[from].arcs.remove(k);
        }
    }

    fn remove_edge(&mut self, from: usize, to: usize) {
        self.remove_half(from, to);
        self.remove_half(to, from);
    }

    fn append_edge(&mut self, from: usize, to: usize, color: i32, kind: Kind) {
        if self.nodes[from].arcs.iter().any(|&a| self.arcs[a].to == to)
            || self.nodes[to].arcs.iter().any(|&a| self.arcs[a].to == from)
        {
            return;
        }
        self.nodes[from].arcs.push(self.arcs.len());
        self.arcs.push(Arc { from, to, color, kind });
        if kind == Kind::NonBorder {
            self.nodes[to].arcs.push(self.arcs.len());
            self.arcs.push(Arc { from: to, to: from, color, kind });
        }
    }

    fn link(&mut self, from: usize, to: usize) {
        self.append_edge(from, to, -1, Kind::NonBorder);
    }

    /// The outline's arc from point `idx` (border arcs come first, one per point).
    fn border_arc(&self, idx: usize) -> Arc {
        self.arcs[idx]
    }

    fn remove_nodes_with_one_arc(&mut self) {
        let mut queue: std::collections::VecDeque<usize> =
            (self.border..self.nodes.len()).filter(|&n| self.nodes[n].arcs.len() == 1).collect();
        while let Some(from) = queue.pop_front() {
            let Some(&first) = self.nodes[from].arcs.first() else { continue };
            let to = self.arcs[first].to;
            self.remove_edge(from, to);
            if self.nodes[to].arcs.len() == 1 && to >= self.border {
                queue.push_back(to);
            }
        }
    }

    fn add_contours(&mut self, color_poly: &[Vec<ColoredLine>]) {
        self.border = self.nodes.len();
        self.sizes = color_poly.iter().map(Vec::len).collect();
        self.offsets = vec![0; color_poly.len()];
        for k in 1..color_poly.len() {
            self.offsets[k] = self.offsets[k - 1] + self.sizes[k - 1];
        }
        for (poly, lines) in color_poly.iter().enumerate() {
            for (i, line) in lines.iter().enumerate() {
                let (from, to) = (self.global(poly, i), self.global(poly, (i + 1) % lines.len()));
                self.append_edge(from, to, line.color, Kind::Border);
            }
        }
    }
}

/// Orca's `ClosestPointInRadiusLookup`: points filed in a power-of-two grid twice the radius, found among the four
/// cells round the nearest grid corner.
struct Lookup<T> {
    radius: f64,
    log2: u32,
    map: std::collections::HashMap<(i64, i64), Vec<(P, T)>>,
}

impl<T: Copy> Lookup<T> {
    fn new(radius: i64) -> Lookup<T> {
        let mut res = 2 * radius + 4;
        let mut log2 = 0;
        for (above, shift) in [(32767, 16), (127, 8), (7, 4), (1, 2)] {
            if res > above {
                res >>= shift;
                log2 += shift;
            }
        }
        if res > 0 {
            log2 += 1;
        }
        Lookup { radius: radius as f64, log2, map: std::collections::HashMap::new() }
    }

    fn insert(&mut self, at: P, value: T) {
        self.map.entry((at[0] >> self.log2, at[1] >> self.log2)).or_default().push((at, value));
    }

    fn near(&self, at: P) -> impl Iterator<Item = (f64, T)> + '_ {
        let half = (1i64 << self.log2) >> 1;
        let corner = ((at[0] + half) >> self.log2, (at[1] + half) >> self.log2);
        [(-1, -1), (0, -1), (-1, 0), (0, 0)]
            .into_iter()
            .filter_map(move |(dx, dy)| self.map.get(&(corner.0 + dx, corner.1 + dy)))
            .flatten()
            .map(move |(q, v)| (norm2(sub(at, *q)), *v))
    }

    /// The closest within the radius, and its squared distance.
    fn find(&self, at: P) -> Option<(T, f64)> {
        let mut best: Option<(T, f64)> = None;
        for (d2, v) in self.near(at) {
            if best.is_none_or(|b| d2 < b.1) {
                best = Some((v, d2));
            }
        }
        best.filter(|b| b.1 < self.radius * self.radius)
    }

    fn find_all(&self, at: P) -> Vec<T> {
        let r2 = self.radius * self.radius;
        self.near(at).filter(|(d2, _)| *d2 < r2).map(|(_, v)| v).collect()
    }
}

/// boost's `ulp_comparison<double>` with the Voronoi vertex predicate's 128 ULPs: equal.
fn ulp_equal(a: f64, b: f64) -> bool {
    let map = |x: f64| {
        let bits = x.to_bits();
        if bits < 0x8000_0000_0000_0000 { 0x8000_0000_0000_0000 - bits } else { bits }
    };
    map(a).abs_diff(map(b)) <= 128
}

/// `points_inside`: whether `new_point` lies inside, seen from the corner where two outline lines meet.
fn points_inside(first: &Line, second: &Line, new_point: [f64; 2]) -> bool {
    let normal = |left: P, middle: P, right: P| {
        let n = |v: [f64; 2]| {
            let l = norm2(v).sqrt();
            [v[0] / l, v[1] / l]
        };
        // perp: (-y, x).
        let d1 = sub(middle, left);
        let d2 = sub(right, middle);
        let a = n([-d1[1], d1[0]]);
        let b = n([-d2[1], d2[0]]);
        n([a[0] + b[0], a[1] + b[1]])
    };
    let inward = normal(first.a, first.b, second.b);
    let e = [new_point[0] - first.b[0] as f64, new_point[1] - first.b[1] as f64];
    let l = norm2(e).sqrt();
    dot(inward, [e[0] / l, e[1] / l]) > 0.0
}

fn intersection_with_epsilon(line_to_extend: &Line, other: &Line) -> Option<P> {
    let mut extended = *line_to_extend;
    extended.extend(15.0 * SCALED_EPSILON as f64);
    extended.intersection(other)
}

fn closer_to_start(line: &Line, q: P) -> bool {
    norm2(sub(q, line.a)) < norm2(sub(q, line.b))
}

fn trunc(q: [f64; 2]) -> P {
    [q[0] as i64, q[1] as i64]
}

fn round(q: [f64; 2]) -> P {
    [q[0].round() as i64, q[1].round() as i64]
}

// ---------------------------------------------------------------------------------------------------------------
// boost's Voronoi diagram, repaired as Orca's `Geometry::VoronoiDiagram` repairs it (Voronoi.cpp, VoronoiUtils.cpp,
// VoronoiUtilsCgal.cpp).

use boostvoronoi::prelude::{Diagram, EdgeIndex, VertexIndex};

/// A diagram, and each of its vertices' points in the outline's own frame.
struct Voronoi {
    diagram: Diagram,
    xy: Vec<[f64; 2]>,
}

fn diagram_of(segments: &[[i32; 4]]) -> Option<Diagram> {
    use boostvoronoi::prelude::{Builder, Line as BvLine};
    let built = Builder::<i32>::default().with_segments(segments.iter().map(|s| BvLine::<i32>::from(*s)));
    built.and_then(|b| b.build()).ok()
}

fn points_of(diagram: &Diagram) -> Vec<[f64; 2]> {
    diagram.vertices().iter().map(|v| [v.x(), v.y()]).collect()
}

/// Orca's `VoronoiDiagram::construct_voronoi`: boost's diagram of the segments, unless it has one of the faults Orca
/// looks for (`detect_known_issues`); then the diagram of the segments turned by 30° (else 36°, then 25.7°, then
/// 16.4°: the first without faults, or the last), its vertices turned back, those at the segments' ends put back on
/// them exactly.
fn voronoi(segments: &[[i32; 4]]) -> Option<Voronoi> {
    let diagram = diagram_of(segments)?;
    let xy = points_of(&diagram);
    if !faulty(&diagram, &xy, segments) {
        return Some(Voronoi { diagram, xy });
    }
    let mut out = Voronoi { diagram, xy };
    for angle in [
        std::f64::consts::PI / 6.0,
        std::f64::consts::PI / 5.0,
        std::f64::consts::PI / 7.0,
        std::f64::consts::PI / 11.0,
    ] {
        let turned: Vec<[i32; 4]> = segments
            .iter()
            .map(|s| {
                let (a, b) = (turn_point([s[0], s[1]], angle), turn_point([s[2], s[3]], angle));
                [a[0], a[1], b[0], b[1]]
            })
            .collect();
        let Some(diagram) = diagram_of(&turned) else { continue };
        let xy = points_of(&diagram);
        let fault = faulty(&diagram, &xy, &turned);
        let xy = turn_back(&diagram, &xy, &turned, segments, angle);
        out = Voronoi { diagram, xy };
        if !fault {
            break;
        }
    }
    Some(out)
}

/// Orca's `Point::rotate`: turned round the origin, to whole units.
fn turn_point(p: [i32; 2], angle: f64) -> [i32; 2] {
    let (sin, cos) = (libm::sin(angle), libm::cos(angle));
    let (x, y) = (f64::from(p[0]), f64::from(p[1]));
    [(cos * x - sin * y).round() as i32, (cos * y + sin * x).round() as i32]
}

fn vertex0(diagram: &Diagram, e: EdgeIndex) -> Option<VertexIndex> {
    diagram.edge(e).ok().and_then(|edge| edge.vertex0())
}

fn vertex1(diagram: &Diagram, e: EdgeIndex) -> Option<VertexIndex> {
    diagram.edge_get_vertex1(e).ok().flatten()
}

/// Orca's `VoronoiUtils::compute_segment_cell_range`: in a segment's cell, the last edge starting at the segment's
/// second end before any other, and the edge ending at its first end; None where either is missing.
fn segment_cell_range(
    diagram: &Diagram,
    xy: &[[f64; 2]],
    first: EdgeIndex,
    segment: [i32; 4],
) -> Option<(EdgeIndex, EdgeIndex)> {
    let from = [i64::from(segment[0]), i64::from(segment[1])];
    let to = [i64::from(segment[2]), i64::from(segment[3])];
    let at = |v: VertexIndex| {
        let q = xy[v.usize()];
        [q[0].round() as i64, q[1].round() as i64]
    };
    let (mut begin, mut end) = (None, None);
    let (mut seen_start, mut after_start, mut end_before_start) = (false, false, false);
    let mut e = first;
    for _ in 0..=diagram.edges().len() {
        if let (Some(v0), Some(v1)) = (vertex0(diagram, e), vertex1(diagram, e)) {
            if at(v0) == to && !after_start {
                begin = Some(e);
                seen_start = true;
            } else if seen_start {
                after_start = true;
            }
            if at(v1) == from && (end.is_none() || end_before_start) {
                end_before_start = !after_start;
                end = Some(e);
            }
        }
        e = diagram.edge_get_next(e).ok()?;
        if e == first {
            break;
        }
    }
    Some((begin?, end?))
}

/// Orca's `detect_known_issues`: a finite edge with an end that isn't, a parabola with no point for its focus, a
/// segment's cell that doesn't run from one of its ends to the other along finite edges all on its left, or edges
/// round a vertex out of turn (`is_voronoi_diagram_planar_angle`).
fn faulty(diagram: &Diagram, xy: &[[f64; 2]], segments: &[[i32; 4]]) -> bool {
    let finite = |v: VertexIndex| xy[v.usize()].iter().all(|c| c.is_finite());
    let cell_of =
        |e: EdgeIndex| diagram.edge(e).ok().and_then(|edge| edge.cell().ok()).and_then(|c| diagram.cell(c).ok());
    let twin_of = |e: EdgeIndex| diagram.edge(e).ok().and_then(|edge| edge.twin().ok());
    for edge in diagram.edges() {
        let e = edge.id();
        if let (Some(v0), Some(v1)) = (vertex0(diagram, e), vertex1(diagram, e)) {
            if !finite(v0) || !finite(v1) {
                return true;
            }
            let point_in = |c: Option<&boostvoronoi::prelude::Cell>| c.is_some_and(|c| c.contains_point());
            if edge.is_curved() && !point_in(cell_of(e)) && !point_in(twin_of(e).and_then(cell_of)) {
                return true;
            }
        }
    }
    for cell in diagram.cells() {
        if cell.is_degenerate() || !cell.contains_segment() {
            continue;
        }
        let segment = segments[cell.source_index().usize()];
        let Some(first) = cell.get_incident_edge() else { continue };
        let Some((begin, end)) = segment_cell_range(diagram, xy, first, segment) else { return true };
        let from = [f64::from(segment[0]), f64::from(segment[1])];
        let along = [f64::from(segment[2] - segment[0]), f64::from(segment[3] - segment[1])];
        let mut e = begin;
        for _ in 0..=diagram.edges().len() {
            if e == end {
                break;
            }
            let (Some(_), Some(v1)) = (vertex0(diagram, e), vertex1(diagram, e)) else { return true };
            let q = xy[v1.usize()];
            if cross(along, [q[0] - from[0], q[1] - from[1]]) < 0.0 {
                return true;
            }
            let Ok(next) = diagram.edge_get_next(e) else { return true };
            e = next;
        }
    }
    !planar(diagram, xy, segments)
}

/// The sign of a turn: 1 left, -1 right, 0 straight on.
fn turn_sign(v: f64) -> i32 {
    if v > 0.0 {
        1
    } else if v < 0.0 {
        -1
    } else {
        0
    }
}

/// The tangent where a parabolic edge leaves its first vertex (`calculate_parabolic_tangent_vector`), its focus the
/// point of one of its cells and its directrix the other's segment, turned to the side of the focus.
fn parabola_tangent(diagram: &Diagram, xy: &[[f64; 2]], segments: &[[i32; 4]], e: EdgeIndex) -> Option<[f64; 2]> {
    let edge = diagram.edge(e).ok()?;
    let left = diagram.cell(edge.cell().ok()?).ok()?;
    let right = diagram.cell(diagram.edge(edge.twin().ok()?).ok()?.cell().ok()?).ok()?;
    let (point_cell, segment_cell) = if left.contains_point() { (left, right) } else { (right, left) };
    let s = segments[point_cell.source_index().usize()];
    let focus = if point_cell.contains_segment_startpoint() {
        [f64::from(s[0]), f64::from(s[1])]
    } else {
        [f64::from(s[2]), f64::from(s[3])]
    };
    let d = segments[segment_cell.source_index().usize()];
    let (u, v) = ([f64::from(d[0]), f64::from(d[1])], [f64::from(d[2]), f64::from(d[3])]);
    let (p, q) = (xy[vertex0(diagram, e)?.usize()], xy[vertex1(diagram, e)?.usize()]);
    // The focus's side, as Orca has it: the opposite of the turn from the edge's ends to it.
    let side = -turn_sign(cross([q[0] - p[0], q[1] - p[1]], [focus[0] - p[0], focus[1] - p[1]]));
    let dir = [v[0] - u[0], v[1] - u[1]];
    let len2 = dot(dir, dir);
    let along = dot(dir, [p[0] - u[0], p[1] - u[1]]);
    let f = [(focus[0] - u[0]) * len2 - dir[0] * along, (focus[1] - u[1]) * len2 - dir[1] * along];
    Some(if side == 1 { [-f[1], f[0]] } else { [f[1], -f[0]] })
}

/// Orca's `orientation_of_two_edges`: which way edge `b` turns from edge `a`, both leaving the same vertex.
fn edge_turn(diagram: &Diagram, xy: &[[f64; 2]], segments: &[[i32; 4]], a: EdgeIndex, b: EdgeIndex) -> Option<i32> {
    let p = xy[vertex0(diagram, a)?.usize()];
    let curved = |e: EdgeIndex| diagram.edge(e).is_ok_and(|edge| edge.is_curved());
    let to = |e: EdgeIndex| -> Option<[f64; 2]> {
        let q = xy[vertex1(diagram, e)?.usize()];
        Some([q[0] - p[0], q[1] - p[1]])
    };
    Some(match (curved(a), curved(b)) {
        (false, false) => turn_sign(cross(to(a)?, to(b)?)),
        (true, true) => {
            turn_sign(cross(parabola_tangent(diagram, xy, segments, a)?, parabola_tangent(diagram, xy, segments, b)?))
        }
        (true, false) => turn_sign(cross(parabola_tangent(diagram, xy, segments, a)?, to(b)?)),
        (false, true) => -turn_sign(cross(parabola_tangent(diagram, xy, segments, b)?, to(a)?)),
    })
}

/// Orca's `is_voronoi_diagram_planar_angle`: round every vertex with three finite edges or more, each edge lies
/// counter-clockwise between the one before it and the one after (`check_if_three_edges_are_ccw`).
fn planar(diagram: &Diagram, xy: &[[f64; 2]], segments: &[[i32; 4]]) -> bool {
    let finite = |v: Option<VertexIndex>| v.is_some_and(|v| xy[v.usize()].iter().all(|c| c.is_finite()));
    for v in diagram.vertices() {
        let Ok(first) = v.get_incident_edge() else { continue };
        let mut edges = Vec::new();
        let mut e = first;
        for _ in 0..=diagram.edges().len() {
            if finite(vertex0(diagram, e)) && finite(vertex1(diagram, e)) {
                edges.push(e);
            }
            match diagram.edge_rot_next(e) {
                Some(next) if next != first => e = next,
                _ => break,
            }
        }
        if edges.len() <= 2 {
            continue;
        }
        for i in 0..edges.len() {
            let prev = edges[(i + edges.len() - 1) % edges.len()];
            let (curr, next) = (edges[i], edges[(i + 1) % edges.len()]);
            let turn = |a, b| edge_turn(diagram, xy, segments, a, b).unwrap_or(0);
            let ccw = match turn(prev, curr) {
                0 => turn(prev, next) == -1,
                1 => turn(prev, next) != 1 || turn(curr, next) != -1,
                _ => turn(prev, next) == -1 || turn(curr, next) == 1,
            };
            if !ccw {
                return false;
            }
        }
    }
    true
}

/// The vertices of a diagram of the segments turned by `angle` (`turned`), back in the segments' own frame: those at
/// a segment's ends (where a segment's cell starts and ends) on those ends exactly, the others turned back.
fn turn_back(
    diagram: &Diagram,
    xy: &[[f64; 2]],
    turned: &[[i32; 4]],
    segments: &[[i32; 4]],
    angle: f64,
) -> Vec<[f64; 2]> {
    // Each vertex's segment end: 0 for none, else (segment + 1) × 2, plus 1 for its second end.
    let mut end_of = vec![0usize; xy.len()];
    for cell in diagram.cells() {
        if cell.is_degenerate() || !cell.contains_segment() {
            continue;
        }
        let k = cell.source_index().usize();
        let Some(first) = cell.get_incident_edge() else { continue };
        if let Some((begin, end)) = segment_cell_range(diagram, xy, first, turned[k]) {
            if let Some(v) = vertex1(diagram, end).filter(|v| end_of[v.usize()] == 0) {
                end_of[v.usize()] = (k + 1) << 1;
            }
            if let Some(v) = vertex0(diagram, begin).filter(|v| end_of[v.usize()] == 0) {
                end_of[v.usize()] = ((k + 1) << 1) | 1;
            }
        }
    }
    let (sin, cos) = (libm::sin(-angle), libm::cos(-angle));
    xy.iter()
        .zip(&end_of)
        .map(|(q, &end)| match end {
            0 => [cos * q[0] - sin * q[1], cos * q[1] + sin * q[0]],
            _ => {
                let s = segments[(end >> 1) - 1];
                if end & 1 == 0 { [f64::from(s[0]), f64::from(s[1])] } else { [f64::from(s[2]), f64::from(s[3])] }
            }
        })
        .collect()
}

/// `build_graph`: the island's coloured outline and the Voronoi diagram of its pieces, joined into a graph whose
/// faces are the island's pieces of one colour. None where the diagram can't be made.
fn build_graph(color_poly: &[Vec<ColoredLine>]) -> Option<Graph> {
    let lines: Vec<ColoredLine> = color_poly.iter().flatten().copied().collect();
    let points: Vec<P> = lines.iter().map(|l| l.line.a).collect();
    // The loops' own lines, from point to point (the coloured pieces meet end to start).
    let poly_lines: Vec<Line> = color_poly
        .iter()
        .flat_map(|ls| (0..ls.len()).map(move |i| Line::new(ls[i].line.a, ls[(i + 1) % ls.len()].line.a)))
        .collect();
    // Where a loop is coloured all one colour, the graph needs at least one edge from it (else an outer contour in
    // one colour and a hole in another would come out in one).
    let mut force: Vec<bool> = color_poly.iter().map(|ls| ls.iter().all(|l| l.color == ls[0].color)).collect();

    let segments: Vec<[i32; 4]> = lines
        .iter()
        .map(|l| [l.line.a[0] as i32, l.line.a[1] as i32, l.line.b[0] as i32, l.line.b[1] as i32])
        .collect();
    let Voronoi { diagram, xy } = voronoi(&segments)?;

    let mut graph = Graph {
        nodes: points.iter().map(|q| Node { point: [q[0] as f64, q[1] as f64], arcs: Vec::new() }).collect(),
        ..Default::default()
    };
    graph.add_contours(color_poly);
    // The lines in the graph's order, knowing their loop and place.
    let mut colored = lines.clone();
    for (poly, ls) in color_poly.iter().enumerate() {
        for i in 0..ls.len() {
            let g = graph.global(poly, i);
            colored[g].poly = poly;
            colored[g].local = i;
        }
    }
    let mut bbox = [i64::MAX, i64::MAX, i64::MIN, i64::MIN];
    for q in &points {
        bbox = [bbox[0].min(q[0]), bbox[1].min(q[1]), bbox[2].max(q[0]), bbox[3].max(q[1])];
    }

    // `append_voronoi_vertices`: each Voronoi vertex a node (one already there where it sits on the outline, or as
    // good as on another vertex), or none outside the outline's box.
    let vertices = diagram.vertices();
    let edges = diagram.edges();
    let cell_source = |edge: usize| -> usize {
        let e = &edges[edge];
        e.cell().ok().and_then(|c| diagram.cell(c).ok()).map_or(0, |c| c.source_index().usize())
    };
    let twin = |edge: usize| -> usize { edges[edge].twin().map_or(edge, |t| t.usize()) };
    let mut vertex_node = vec![NONE; vertices.len()];
    {
        let b =
            [bbox[0] - SCALED_EPSILON, bbox[1] - SCALED_EPSILON, bbox[2] + SCALED_EPSILON, bbox[3] + SCALED_EPSILON];
        let mut voronoi_points: Lookup<(usize, [f64; 2])> = Lookup::new(SCALED_EPSILON);
        let mut contour_points: Lookup<usize> = Lookup::new(3 * SCALED_EPSILON);
        for (poly, ls) in color_poly.iter().enumerate() {
            for (i, l) in ls.iter().enumerate() {
                contour_points.insert(l.line.a, graph.global(poly, i));
            }
        }
        for (k, v) in vertices.iter().enumerate() {
            let vd = xy[k];
            let vp = trunc(vd);
            let Ok(incident) = v.get_incident_edge() else { continue };
            let incident = incident.usize();
            let first = graph.border_arc(cell_source(incident)).from;
            let second = graph.border_arc(cell_source(twin(incident))).from;
            let equal =
                |n: usize| ulp_equal(vd[0], graph.nodes[n].point[0]) && ulp_equal(vd[1], graph.nodes[n].point[1]);
            if equal(first) {
                vertex_node[k] = first;
            } else if equal(second) {
                vertex_node[k] = second;
            } else if vp[0] >= b[0] && vp[0] <= b[2] && vp[1] >= b[1] && vp[1] <= b[3] {
                if let Some((n, d2)) = contour_points.find(vp).filter(|f| f.1 < (3 * SCALED_EPSILON).pow(2) as f64) {
                    let _ = d2;
                    vertex_node[k] = n;
                } else if voronoi_points.find(vp).is_none_or(|(_, d2)| d2 >= (SCALED_EPSILON as f64 / 10.0).powi(2)) {
                    let n = graph.nodes.len();
                    voronoi_points.insert(round(vd), (n, vd));
                    vertex_node[k] = n;
                    graph.nodes.push(Node { point: vd, arcs: Vec::new() });
                } else {
                    // boost sometimes makes two vertices a hair apart where there is one.
                    let eps2 = (1e-4 / 100.0f64).powi(2);
                    let merge = voronoi_points
                        .find_all(vp)
                        .into_iter()
                        .find(|(_, q)| norm2([vd[0] - q[0], vd[1] - q[1]]) <= eps2)
                        .map(|(n, _)| n);
                    match merge {
                        Some(n) => vertex_node[k] = n,
                        None => {
                            let n = graph.nodes.len();
                            voronoi_points.insert(round(vd), (n, vd));
                            vertex_node[k] = n;
                            graph.nodes.push(Node { point: vd, arcs: Vec::new() });
                        }
                    }
                }
            }
        }
    }

    let node_of = |v: Option<boostvoronoi::prelude::VertexIndex>| v.map_or(NONE, |v| vertex_node[v.usize()]);
    let v0 = |edge: usize| edges[edge].vertex0();
    let v1 = |edge: usize| diagram.edge_get_vertex1(edges[edge].id()).ok().flatten();
    let offsets = graph.offsets.clone();
    let prev_line = |src: usize| {
        let c = &colored[src];
        let size = color_poly[c.poly].len();
        colored[offsets[c.poly] + if c.local > 0 { c.local - 1 } else { size - 1 }]
    };
    let next_line = |src: usize| {
        let c = &colored[src];
        colored[offsets[c.poly] + (c.local + 1) % color_poly[c.poly].len()]
    };
    let clip_box = [
        (bbox[0] as f64) - scaled(10.0),
        (bbox[1] as f64) - scaled(10.0),
        (bbox[2] as f64) + scaled(10.0),
        (bbox[3] as f64) + scaled(10.0),
    ];
    let bbox_dim_max = (clip_box[2] - clip_box[0]).max(clip_box[3] - clip_box[1]);
    let mut processed = vec![false; edges.len()];
    let mark = |processed: &mut Vec<bool>, e: usize| {
        processed[e] = true;
        processed[twin(e)] = true;
    };
    let nodes_count = |g: &Graph| g.nodes.len();
    let vertex_xy = |v: boostvoronoi::prelude::VertexIndex| xy[v.usize()];

    for e in 0..edges.len() {
        if cell_source(e) > cell_source(twin(e)) || processed[e] {
            continue;
        }
        let (a, b) = (v0(e), v1(e));
        let finite = a.is_some() && b.is_some();
        let src = cell_source(e);
        if !finite && (a.is_some() || b.is_some()) {
            // An infinite edge through a point of the outline with no Voronoi vertex there: its crossing with the
            // outline's line found by clipping it (`clip_infinite_edge`).
            let Some(samples) = clip_infinite_edge(&diagram, &segments, e, bbox_dim_max, &vertex_xy) else { continue };
            let edge_line = Line::new(trunc(samples[0]), trunc(samples[1]));
            let contour_line = colored[src].line;
            if let Some(hit) = intersection_with_epsilon(&contour_line, &edge_line) {
                let arc = graph.border_arc(src);
                let from = if b.is_some() { node_of(b) } else { node_of(a) };
                let to =
                    if norm2(sub(contour_line.a, hit)) < norm2(sub(contour_line.b, hit)) { arc.from } else { arc.to };
                if from != to && from < nodes_count(&graph) && to < nodes_count(&graph) {
                    graph.link(from, to);
                    mark(&mut processed, e);
                }
            }
        } else if finite {
            let (n0, n1) = (node_of(a), node_of(b));
            let border = graph.border;
            let on = |n: usize| n < border;
            if (on(n0) && on(n1)) || n0 == n1 {
                continue;
            }
            let (p0, p1) = (vertex_xy(a.unwrap()), vertex_xy(b.unwrap()));
            let edge_line = clip_finite(p0, p1, clip_box);
            let contour_line = colored[src].line;
            let line = colored[src];
            let prev = prev_line(src);
            let next = next_line(src);
            if n0 >= nodes_count(&graph) || n1 >= nodes_count(&graph) {
                let tsrc = cell_source(twin(e));
                let mut attach = |graph: &mut Graph, node: usize| {
                    let twin_line = colored[tsrc].line;
                    if let Some(hit) = intersection_with_epsilon(&twin_line, &edge_line) {
                        let arc = graph.border_arc(tsrc);
                        let to = if closer_to_start(&twin_line, hit) { arc.from } else { arc.to };
                        graph.link(node, to);
                    } else if let Some(hit) = intersection_with_epsilon(&contour_line, &edge_line) {
                        let arc = graph.border_arc(src);
                        let to = if closer_to_start(&contour_line, hit) { arc.from } else { arc.to };
                        graph.link(node, to);
                    }
                    mark(&mut processed, e);
                };
                if n0 < nodes_count(&graph) && !on(n0) {
                    attach(&mut graph, n0);
                }
                if n1 < nodes_count(&graph) && !on(n1) {
                    attach(&mut graph, n1);
                }
            } else if on(n0) || on(n1) {
                mark(&mut processed, e);
                let poly = line.poly;
                let ea = [edge_line.a[0] as f64, edge_line.a[1] as f64];
                let eb = [edge_line.b[0] as f64, edge_line.b[1] as f64];
                let (near_end, far) = if on(n0) { (edge_line.a, eb) } else { (edge_line.b, ea) };
                let ok = if closer_to_start(&contour_line, near_end) {
                    (prev.color != line.color || force[poly]) && points_inside(&prev.line, &contour_line, far)
                } else {
                    (next.color != line.color || force[poly]) && points_inside(&contour_line, &next.line, far)
                };
                if ok {
                    graph.link(n0, n1);
                    force[poly] = false;
                }
            } else if let Some(hit) = intersection_with_epsilon(&contour_line, &edge_line) {
                mark(&mut processed, e);
                let real0 = trunc(graph.nodes[n0].point);
                let real1 = trunc(graph.nodes[n1].point);
                let r0 = [real0[0] as f64, real0[1] as f64];
                let r1 = [real1[0] as f64, real1[1] as f64];
                if closer_to_start(&contour_line, hit) {
                    if prev.color != line.color {
                        let to = graph.border_arc(src).from;
                        if points_inside(&prev.line, &contour_line, r0) {
                            graph.link(n0, to);
                        }
                        if points_inside(&prev.line, &contour_line, r1) {
                            graph.link(n1, to);
                        }
                    }
                } else {
                    let to = graph.border_arc(src).to;
                    if next.color != line.color {
                        if points_inside(&contour_line, &next.line, r0) {
                            graph.link(n0, to);
                        }
                        if points_inside(&contour_line, &next.line, r1) {
                            graph.link(n1, to);
                        }
                    }
                }
            }
        }
    }
    for e in 0..edges.len() {
        if cell_source(e) > cell_source(twin(e)) || processed[e] {
            continue;
        }
        let (n0, n1) = (node_of(v0(e)), node_of(v1(e)));
        if v0(e).is_some() && v1(e).is_some() && n0 < nodes_count(&graph) && n1 < nodes_count(&graph) && n0 != n1 {
            graph.link(n0, n1);
        }
        mark(&mut processed, e);
    }
    let _ = poly_lines;
    graph.remove_nodes_with_one_arc();
    Some(graph)
}

/// `clip_finite_voronoi_edge`: a finite edge as a line, an end outside the box (one only) pulled back along it.
fn clip_finite(v0: [f64; 2], v1: [f64; 2], b: [f64; 4]) -> Line {
    let inside = |q: [f64; 2]| q[0] >= b[0] && q[0] <= b[2] && q[1] >= b[1] && q[1] <= b[3];
    let (c0, c1) = (inside(v0), inside(v1));
    if c0 == c1 {
        return Line::new(trunc(v0), trunc(v1));
    }
    let d = [v1[0] - v0[0], v1[1] - v0[1]];
    let l = norm2(d).sqrt();
    let size = ((b[2] - b[0]).powi(2) + (b[3] - b[1]).powi(2)).sqrt();
    let vector = [d[0] / l * size, d[1] / l * size];
    let (mut a, mut z) = (v0, v1);
    if !c0 {
        a = [z[0] - vector[0], z[1] - vector[1]];
    } else {
        z = [a[0] + vector[0], a[1] + vector[1]];
    }
    Line::new(trunc(a), trunc(z))
}

/// `Voronoi::Internal::clip_infinite_edge`: an infinite edge's vertex and a point far along it.
fn clip_infinite_edge(
    diagram: &boostvoronoi::prelude::Diagram,
    segments: &[[i32; 4]],
    e: usize,
    bbox_max: f64,
    vertex_xy: &impl Fn(boostvoronoi::prelude::VertexIndex) -> [f64; 2],
) -> Option<[[f64; 2]; 2]> {
    let edges = diagram.edges();
    let edge = &edges[e];
    let cell1 = diagram.cell(edge.cell().ok()?).ok()?;
    let twin = edge.twin().ok()?;
    let cell2 = diagram.cell(diagram.edge(twin).ok()?.cell().ok()?).ok()?;
    if !cell1.contains_point() && !cell2.contains_point() {
        return None;
    }
    let point_of = |cell: &boostvoronoi::prelude::Cell| {
        let s = segments[cell.source_index().usize()];
        if cell.contains_segment_startpoint() { [s[0] as f64, s[1] as f64] } else { [s[2] as f64, s[3] as f64] }
    };
    let v0 = edge.vertex0();
    let v1 = diagram.edge_get_vertex1(edge.id()).ok().flatten();
    let direction = if cell1.contains_point() && cell2.contains_point() {
        let (mut p1, mut p2) = (point_of(cell1), point_of(cell2));
        if v0.is_none() {
            std::mem::swap(&mut p1, &mut p2);
        }
        [p1[1] - p2[1], p2[0] - p1[0]]
    } else {
        let s = if cell1.contains_segment() {
            segments[cell1.source_index().usize()]
        } else {
            segments[cell2.source_index().usize()]
        };
        // boost's low and high: a segment_data's first end and its second.
        let (lo, hi) = ([s[0], s[1]], [s[2], s[3]]);
        [f64::from(hi[1] - lo[1]), f64::from(lo[0] - hi[0])]
    };
    let koef = bbox_max / direction[0].abs().max(direction[1].abs());
    match (v0, v1) {
        (None, Some(v)) => {
            let q = vertex_xy(v);
            Some([[q[0] + direction[0] * koef, q[1] + direction[1] * koef], q])
        }
        (Some(v), _) => {
            let q = vertex_xy(v);
            Some([q, [q[0] + direction[0] * koef, q[1] + direction[1] * koef]])
        }
        _ => None,
    }
}

/// `get_all_segments`, then `remove_multiple_edges_in_vertices`: where a coloured run starts at an outline point
/// with three arcs or more, only its longest inner path stays.
fn remove_multiple_edges(graph: &mut Graph, color_poly: &[Vec<ColoredLine>]) {
    for (poly, ls) in color_poly.iter().enumerate() {
        for (first, _) in runs(ls) {
            let first_idx = graph.global(poly, first);
            if graph.nodes[first_idx].arcs.len() < 3 {
                continue;
            }
            let mut check: Vec<(usize, f64)> = graph.nodes[first_idx]
                .arcs
                .iter()
                .filter(|&&a| graph.arcs[a].kind == Kind::NonBorder)
                .map(|&a| (graph.arcs[a].to, edge_length(graph, first_idx, a)))
                .collect();
            // std::sort descending by length; equal lengths keep no particular order there.
            check.sort_by(|l, r| r.1.partial_cmp(&l.1).unwrap_or(std::cmp::Ordering::Equal));
            while check.len() > 1 {
                let (to, _) = check.pop().unwrap();
                graph.remove_edge(first_idx, to);
            }
        }
    }
}

/// `compute_edge_length`: an inner path's length from `start` along arc `arc`, on through nodes of two arcs while it
/// turns less than 15°.
fn edge_length(graph: &Graph, start: usize, arc: usize) -> f64 {
    let mut used = vec![false; graph.arcs.len()];
    used[arc] = true;
    let mut arc = graph.arcs[arc];
    let mut idx = start;
    let dist = |a: [f64; 2], b: [f64; 2]| norm2([b[0] - a[0], b[1] - a[1]]).sqrt();
    let mut total = dist(graph.nodes[idx].point, graph.nodes[arc.to].point);
    while graph.nodes[arc.to].arcs.len() == 2 {
        let mut found = false;
        for &k in &graph.nodes[arc.to].arcs {
            let next = graph.arcs[k];
            if next.kind == Kind::NonBorder && !used[k] && next.to != idx {
                let (pa, pb, pc) = (graph.nodes[idx].point, graph.nodes[arc.to].point, graph.nodes[next.to].point);
                let first = [pa[0] - pb[0], pa[1] - pb[1]];
                let second = [pc[0] - pb[0], pc[1] - pb[1]];
                let n = |v: [f64; 2]| {
                    let l = norm2(v).sqrt();
                    [v[0] / l, v[1] / l]
                };
                let (f, s) = (n(first), n(second));
                let mut angle = dot(f, s).clamp(-1.0, 1.0).acos();
                if cross(f, s) < 0.0 {
                    angle = 2.0 * std::f64::consts::PI - angle;
                }
                if (angle - std::f64::consts::PI).abs() >= std::f64::consts::PI / 12.0 {
                    continue;
                }
                idx = arc.to;
                arc = next;
                total += dist(graph.nodes[idx].point, graph.nodes[arc.to].point);
                used[k] = true;
                found = true;
                break;
            }
        }
        if !found {
            break;
        }
    }
    total
}

/// `get_next_arc`: from the arc just walked, the next arc of the face (the leftmost unused one there, in the
/// face's colour along the outline); the arc itself where there is none.
fn next_arc(graph: &Graph, used: &[bool], process: ([f64; 2], [f64; 2]), original: usize, color: i32) -> usize {
    let orig = graph.arcs[original];
    let mut candidates: Vec<(usize, f64)> = Vec::new();
    for &k in &graph.nodes[orig.to].arcs {
        let arc = graph.arcs[k];
        if graph.nodes[arc.to].point == process.0 || used[k] {
            continue;
        }
        if orig.kind == Kind::Border && orig.color != color {
            continue;
        }
        if arc.kind == Kind::Border && arc.color != color {
            continue;
        }
        let n = |v: [f64; 2]| {
            let l = norm2(v).sqrt();
            [v[0] / l, v[1] / l]
        };
        let pv = n([process.0[0] - process.1[0], process.0[1] - process.1[1]]);
        let (a, b) = (graph.nodes[arc.from].point, graph.nodes[arc.to].point);
        let nv = n([b[0] - a[0], b[1] - a[1]]);
        let mut angle = dot(nv, pv).clamp(-1.0, 1.0).acos();
        if cross(nv, pv) < 0.0 {
            angle = 2.0 * std::f64::consts::PI - angle;
        }
        candidates.push((k, angle));
    }
    if candidates.is_empty() {
        return original;
    }
    candidates.sort_by(|l, r| l.1.partial_cmp(&r.1).unwrap_or(std::cmp::Ordering::Equal));
    candidates.iter().find(|c| !used[c.0]).map_or(candidates[0].0, |c| c.0)
}

fn polygon_area2(points: &[P]) -> i128 {
    let n = points.len();
    (0..n)
        .map(|i| {
            let (a, b) = (points[i], points[(i + 1) % n]);
            i128::from(a[0]) * i128::from(b[1]) - i128::from(b[0]) * i128::from(a[1])
        })
        .sum()
}

/// `is_profile_self_interaction`: whether any two lines of the loop that don't meet at a point cross.
fn self_intersects(points: &[P]) -> bool {
    let n = points.len();
    let lines: Vec<Line> = (0..n).map(|i| Line::new(points[i], points[(i + 1) % n])).collect();
    for i in 0..n {
        let end = n.min(n + i - 1);
        for j in i + 2..end {
            if lines[i].intersection(&lines[j]).is_some() {
                return true;
            }
        }
    }
    false
}

/// An arc of a face being walked (none for the one closing it) and its ends.
type FaceArc = (Option<usize>, ([f64; 2], [f64; 2]));

/// `extract_colored_segments`: the graph's faces walked from each outline arc, each face (counter-clockwise) the
/// colour of the arc it starts from; a walk that doesn't close is cut back until what is left does.
fn extract(graph: &Graph, states: usize) -> Vec<Vec<Vec<P>>> {
    let mut used = vec![false; graph.arcs.len()];
    let mut out: Vec<Vec<Vec<P>>> = vec![Vec::new(); states];
    for node in 0..graph.border {
        for &start in &graph.nodes[node].arcs {
            let arc = graph.arcs[start];
            if arc.kind == Kind::NonBorder || used[start] {
                continue;
            }
            let line = (graph.nodes[arc.from].point, graph.nodes[arc.to].point);
            used[start] = true;
            let mut face: Vec<FaceArc> = vec![(Some(start), line)];
            let start_p = line.0;
            let mut p_vec = line;
            let mut p_arc = start;
            loop {
                let next = next_arc(graph, &used, p_vec, p_arc, arc.color);
                if used[next] {
                    break;
                }
                let n = graph.arcs[next];
                let l = (graph.nodes[n.from].point, graph.nodes[n.to].point);
                face.push((Some(next), l));
                used[next] = true;
                p_vec = l;
                p_arc = next;
                let to = graph.arcs[p_arc].to;
                if graph.nodes[to].point == start_p && graph.nodes[to].arcs.iter().all(|&a| used[a]) {
                    break;
                }
            }
            let points = |face: &[FaceArc]| face.iter().map(|f| round(f.1.0)).collect::<Vec<P>>();
            let poly = points(&face);
            let color = arc.color.max(0) as usize;
            if poly.len() >= 3 && polygon_area2(&poly) > 0 {
                if color < states {
                    out[color].push(poly);
                }
                continue;
            }
            while face.len() > 1 {
                let (id, _) = face.pop().unwrap();
                if let Some(id) = id {
                    used[id] = false;
                }
                let closing = (face.last().unwrap().1.1, face[0].1.0);
                face.push((None, closing));
                let poly = points(&face);
                if !self_intersects(&poly) && poly.len() >= 3 && polygon_area2(&poly) > 0 {
                    if color < states {
                        out[color].push(poly);
                    }
                    break;
                }
                face.pop();
            }
        }
    }
    out
}

/// One island's pieces by colour (`states` colours, 0 unpainted): its whole where its outline is in one colour,
/// else the faces of its graph, those of one colour merged where it has 64 loops or fewer.
pub(crate) fn split_island(island: &Shape, color_poly: &[Vec<ColoredLine>], states: usize) -> Vec<Shapes> {
    let mut out = vec![Vec::new(); states];
    let first = color_poly.iter().flatten().next().map_or(0, |l| l.color);
    if color_poly.iter().flatten().all(|l| l.color == first) {
        if (first as usize) < states {
            out[first as usize].push(island.clone());
        }
        return out;
    }
    let Some(mut graph) = build_graph(color_poly) else { return out };
    remove_multiple_edges(&mut graph, color_poly);
    graph.remove_nodes_with_one_arc();
    for (color, faces) in extract(&graph, states).into_iter().enumerate() {
        let shapes: Shapes = faces
            .into_iter()
            .map(|f| vec![f.into_iter().map(|q| geom::pt(q[0] as i32, q[1] as i32)).collect()])
            .collect();
        out[color] =
            if color_poly.len() <= 64 && shapes.len() > 1 { geom::union(&shapes, &Vec::new()) } else { shapes };
    }
    out
}

// ---------------------------------------------------------------------------------------------------------------
// An object's layers split by its paint, and its regions re-split by them.

type Corners = [[f32; 3]; 3];

/// An object's painted triangles, split into the leaves Orca's TriangleSelector makes, each with its state: its
/// meshes as they now lie, each mesh's paint going by its triangles (a turned one's code by the file's corner order).
pub fn facets(meshes: &[(&crate::mesh::Mesh, &crate::paint::Paint)]) -> Vec<(i32, Corners)> {
    let mut out = Vec::new();
    for (mesh, paint) in meshes {
        for (t, code, turned) in paint.iter() {
            let Some(tri) = mesh.triangles.get(t as usize) else { continue };
            let c = tri.map(|v| mesh.vertices[v as usize]);
            let corners = if turned { [c[0], c[2], c[1]] } else { c };
            let Some(leaves) = crate::paint::leaves(code, corners) else { continue };
            out.extend(leaves.into_iter().filter(|l| l.1 > 0).map(|(corners, state)| (state as i32, corners)));
        }
    }
    out
}

fn bbox_of_shapes(shapes: &Shapes) -> Option<[i64; 4]> {
    geom::bbox(shapes).map(|b| [i64::from(b[0]), i64::from(b[1]), i64::from(b[2]), i64::from(b[3])])
}

fn merge_box(a: Option<[i64; 4]>, b: Option<[i64; 4]>) -> Option<[i64; 4]> {
    match (a, b) {
        (Some(a), Some(b)) => Some([a[0].min(b[0]), a[1].min(b[1]), a[2].max(b[2]), a[3].max(b[3])]),
        (a, None) => a,
        (None, b) => b,
    }
}

/// `multi_material_segmentation_by_painting` for one object, its painted sides: each layer's shapes painted in each
/// filament (`[layer][filament]`, filament 0 the first), from its layers' shapes (all its regions) cut at `slice_z`
/// and its painted triangles (`facets`), for `filaments` filaments.
pub fn painted_regions(
    slice_z: &[f64],
    layers: &[Shapes],
    facets: &[(i32, Corners)],
    filaments: usize,
) -> Vec<Vec<Shapes>> {
    let n = layers.len();
    let states = filaments + 1;
    let outlines: Vec<Shapes> = crate::par::map_range(n, |l| outline(&layers[l]));
    let boxes: Vec<Option<[i64; 4]>> =
        (0..n).map(|l| merge_box(bbox_of_shapes(&layers[l]), bbox_of_shapes(&outlines[l]))).collect();
    let grids: Vec<Option<Grid>> = crate::par::map_range(n, |l| {
        if outlines[l].is_empty() {
            return None;
        }
        let mut b = boxes[l];
        // Orca merges the layer below from the third layer on (`layer_idx > 1`), and the one above.
        if l > 1 {
            b = merge_box(b, boxes[l - 1]);
        }
        if l + 1 < n {
            b = merge_box(b, boxes[l + 1]);
        }
        let b = b?;
        let reach = 20 * SCALED_EPSILON;
        Some(Grid::new([b[0] - reach, b[1] - reach, b[2] + reach, b[3] + reach], &outlines[l], scaled(10.0) as i64))
    });
    let mut painted: Vec<Vec<PaintedLine>> = vec![Vec::new(); n];
    for &(state, facet) in facets {
        if (state as usize) < states {
            project_facet(facet, state, slice_z, &grids, &mut painted);
        }
    }
    let per_layer: Vec<Vec<Shapes>> = crate::par::map_range(n, |l| {
        let mut out = vec![Vec::new(); filaments];
        let Some(grid) = &grids[l] else { return out };
        if painted[l].is_empty() {
            return out;
        }
        let lines = post_process(&grid.contours, painted[l].clone());
        let color_poly = colorize(&grid.contours, &lines);
        // Each island on its own: its contour and holes are the grid's next loops.
        let mut at = 0;
        for island in &outlines[l] {
            let count = island.iter().filter(|c| !c.is_empty()).count();
            let polys = &color_poly[at..at + count];
            at += count;
            if polys.is_empty() {
                continue;
            }
            for (state, shapes) in split_island(island, polys, states).into_iter().enumerate() {
                if state >= 1 {
                    out[state - 1].extend(shapes);
                }
            }
        }
        out
    });
    per_layer
}

/// `apply_mm_segmentation` for one object on one layer: each of its regions (its filament and shapes) gives what is
/// painted in another filament to that filament's region, and keeps the rest opened by 0.5 µm; a region given to
/// more than once is closed by 1 µm. `painted[f]`: the layer's shapes painted in filament `f`.
pub fn apply(regions: &[(usize, Shapes)], painted: &[Shapes]) -> Vec<(usize, Shapes)> {
    let boxes: Vec<Option<[i64; 4]>> = painted.iter().map(bbox_of_shapes).collect();
    if boxes.iter().all(Option::is_none) {
        return regions.to_vec();
    }
    let overlap = |a: [i64; 4], b: [i64; 4]| a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
    // Each filament's region: its shapes, and whether more than one thing went into it.
    let mut by: Vec<(usize, Shapes, bool)> = Vec::new();
    let put = |by: &mut Vec<(usize, Shapes, bool)>, f: usize, shapes: Shapes| {
        if let Some(r) = by.iter_mut().find(|r| r.0 == f) {
            if r.1.is_empty() {
                r.1 = shapes;
            } else {
                r.1.extend(shapes);
                r.2 = true;
            }
        } else {
            by.push((f, shapes, false));
        }
    };
    for (f, _) in regions {
        if !by.iter().any(|r| r.0 == *f) {
            by.push((*f, Vec::new(), false));
        }
    }
    for (f, shapes) in regions {
        let Some(own_box) = bbox_of_shapes(shapes) else { continue };
        for (e, piece) in painted.iter().enumerate() {
            if e == *f || !boxes[e].is_some_and(|b| overlap(own_box, b)) {
                continue;
            }
            let stolen = geom::intersection(shapes, piece);
            if !stolen.is_empty() {
                put(&mut by, e, stolen);
            }
        }
        let mut mine = shapes.clone();
        for (e, piece) in painted.iter().enumerate() {
            if e != *f && boxes[e].is_some_and(|b| overlap(own_box, b)) {
                mine = geom::difference(&mine, piece);
                if mine.is_empty() {
                    break;
                }
            }
        }
        if !mine.is_empty() {
            mine = geom::opening(&geom::union(&mine, &Vec::new()), 5.0 / geom::SCALE);
        }
        if !mine.is_empty() {
            put(&mut by, *f, geom::union(&mine, &Vec::new()));
        }
    }
    by.into_iter()
        .map(|(f, shapes, merge)| (f, if merge { geom::closing(&shapes, 10.0 / geom::SCALE) } else { shapes }))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn square(x0: i32, y0: i32, size: i32) -> Shape {
        vec![vec![geom::pt(x0, y0), geom::pt(x0 + size, y0), geom::pt(x0 + size, y0 + size), geom::pt(x0, y0 + size)]]
    }

    #[test]
    fn the_grid_files_each_segment_under_every_cell_it_crosses() {
        // A 25 mm square on a 10 mm grid: its bottom edge crosses three cells.
        let s = vec![square(0, 0, 250_000)];
        let grid = Grid::new([0, 0, 250_000, 250_000], &s, 100_000);
        assert_eq!((grid.cols, grid.rows), (3, 3));
        let mut seen = Vec::new();
        grid.walk([5, 5], [249_000, 5], &mut |iy, ix| {
            seen.push((iy, ix));
            true
        });
        assert_eq!(seen, vec![(0, 0), (0, 1), (0, 2)]);
        // Each corner cell holds the two edges that meet there.
        assert_eq!(grid.cell(0, 0).len(), 2);
        assert_eq!(grid.cell(1, 1).len(), 0);
    }

    #[test]
    fn a_painted_line_along_an_edge_colours_that_stretch_of_it() {
        let s = vec![square(0, 0, 250_000)];
        let grid = Grid::new([0, 0, 250_000, 250_000], &s, 100_000);
        let mut lines = Vec::new();
        // Along the bottom edge from 5 mm to 15 mm, 2 µm inside: colour 2.
        let along = Line::new([50_000, 20], [150_000, 20]);
        paint_line(&grid, along, along, 2, &mut lines);
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].projected, Line::new([50_000, 0], [150_000, 0]));
        let painted = post_process(&grid.contours, lines);
        let colored = colorize(&grid.contours, &painted);
        let colors: Vec<(i32, P, P)> = colored[0].iter().map(|c| (c.color, c.line.a, c.line.b)).collect();
        assert_eq!(
            colors,
            vec![
                (0, [0, 0], [50_000, 0]),
                (2, [50_000, 0], [150_000, 0]),
                (0, [150_000, 0], [250_000, 0]),
                (0, [250_000, 0], [250_000, 250_000]),
                (0, [250_000, 250_000], [0, 250_000]),
                (0, [0, 250_000], [0, 0]),
            ]
        );
        // Across the edge (more than 30° off it), or 1 mm inside, it colours nothing.
        let mut none = Vec::new();
        for line in [Line::new([50_000, 20], [60_000, 20_000]), Line::new([50_000, 10_000], [150_000, 10_000])] {
            paint_line(&grid, line, line, 2, &mut none);
        }
        assert!(none.is_empty());
    }

    #[test]
    fn short_runs_between_one_colour_take_it() {
        let l = |x0: i64, x1: i64, c: i32| colored(Line::new([x0, 0], [x1, 0]), c);
        // 0.1 mm of unpainted between two stretches in 1: painted 1.
        let out = filter_colorized(vec![l(0, 20_000, 1), l(20_000, 21_000, 0), l(21_000, 40_000, 1), l(40_000, 0, 0)]);
        assert_eq!(out.iter().map(|c| c.color).collect::<Vec<_>>(), vec![1, 1, 1, 0]);
    }

    #[test]
    fn a_stretch_painted_partway_along_an_edge_takes_its_side_of_the_island() {
        // A 9.67 by 20 mm island whose left edge is painted (2) from its bottom corner to halfway up: boost's diagram
        // has no vertex where the paint ends (Orca rebuilds it turned by 30°), and the edge from there must run
        // inside. The paint takes what is nearer its stretch: a trapezoid from that edge's ends to the middle line,
        // 4.83 mm wide, 10.33 mm tall at the edge and 5.5 at the middle.
        let corners = [
            (1_380_000, 1_380_000),
            (1_283_333, 1_380_000),
            (1_283_333, 1_283_333),
            (1_283_333, 1_180_000),
            (1_380_000, 1_180_000),
        ];
        let colours = [0, 0, 2, 0, 0];
        let mut poly: Vec<ColoredLine> = (0..5)
            .map(|i| {
                let (a, b) = (corners[i], corners[(i + 1) % 5]);
                colored(Line::new([a.0, a.1], [b.0, b.1]), colours[i])
            })
            .collect();
        for (k, l) in poly.iter_mut().enumerate() {
            l.local = k;
        }
        let segments: Vec<[i32; 4]> = poly
            .iter()
            .map(|l| [l.line.a[0] as i32, l.line.a[1] as i32, l.line.b[0] as i32, l.line.b[1] as i32])
            .collect();
        let plain = diagram_of(&segments).expect("a diagram");
        let xy = points_of(&plain);
        assert!(faulty(&plain, &xy, &segments), "boost's own diagram has no fault");
        // In it, the edges from the middle line's vertex out through where the paint ends run left across the
        // outline, as Orca clips them (`clip_infinite_edge`, a segment's ends as boost keeps them).
        let through = |e: &boostvoronoi::prelude::Edge| {
            let one = vertex0(&plain, e.id()).is_some() != vertex1(&plain, e.id()).is_some();
            let at = vertex0(&plain, e.id()).or(vertex1(&plain, e.id())).map(|v| xy[v.usize()]);
            one && at.is_some_and(|q| (q[1] - 1_283_333.0).abs() < 1.0)
        };
        let mut crossing = 0;
        for e in plain.edges().iter().filter(|e| through(e)) {
            let line = clip_infinite_edge(&plain, &segments, e.id().usize(), 1e6, &|v: VertexIndex| xy[v.usize()])
                .expect("clipped");
            assert!(line[0][0].min(line[1][0]) < 1_283_333.0 - 1e5, "{line:?} stays inside");
            crossing += 1;
        }
        assert!(crossing > 0);
        let island: Shape = vec![corners.iter().map(|&(x, y)| geom::pt(x as i32, y as i32)).collect()];
        let out = split_island(&island, &[poly], 3);
        let (painted, rest) = (geom::area_mm2(&out[2]), geom::area_mm2(&out[0]));
        let expected = (9.6667 / 2.0) * (10.3333 + 5.5) / 2.0;
        assert!((painted - expected).abs() < 0.01, "{painted} mm² painted");
        assert!((painted + rest - 9.6667 * 20.0).abs() < 0.01, "{rest} mm² left");
    }

    #[test]
    fn duplicates_that_barely_turn_go() {
        let c = vec![geom::pt(0, 0), geom::pt(1000, 0), geom::pt(1050, 1), geom::pt(2000, 0), geom::pt(2000, 2000)];
        let out = remove_duplicates(c, 100, std::f64::consts::PI / 6.0);
        assert_eq!(out, vec![geom::pt(0, 0), geom::pt(1000, 0), geom::pt(2000, 0), geom::pt(2000, 2000)]);
    }
}
