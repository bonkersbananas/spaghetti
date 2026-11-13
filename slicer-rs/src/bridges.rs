//! Internal bridges (Orca's `PrintObject::bridge_over_infill`): solid infill that rests on sparse infill prints as
//! a bridge where enough of it has nothing but sparse infill under it. Its threads cross the sparse lines below, and
//! reach along their own direction to the nearest of those lines (or the walls) at both ends, so that each thread
//! is held at both ends; the bridge may take sparse infill of its own layer for that. Under a bridge's edge by the
//! walls, the layer below prints solid.

use crate::config::Settings;
use crate::fill;
use crate::geom::{self, Pt, Shapes};
use crate::par;
use crate::region::{Fills, Island};
use crate::section::Layers;
use std::f64::consts::PI;

/// mm: how far an outline may stray from the exact one before it is grown or shrunk (Orca's resolution).
const RESOLUTION: f64 = 0.0125;

/// The sparse infill lines an island of a layer prints in an area: `(layer, island, area)`.
pub type SparseLines<'a> = dyn Fn(usize, usize, &Shapes) -> Vec<Vec<Pt>> + Sync + 'a;

/// Part of a layer's solid infill worth bridging: the island it is in, and the part.
pub struct Candidate {
    pub island: usize,
    pub area: Shapes,
}

/// Every layer's solid infill worth bridging (`candidates`).
pub struct Candidates(Vec<Vec<Candidate>>);

impl Candidates {
    /// Those of layer `l`.
    pub fn on(&self, l: usize) -> impl Iterator<Item = &Candidate> {
        self.0.get(l).into_iter().flatten()
    }
}

/// Every layer's solid infill worth bridging, for `bridge_over_infill`.
pub fn candidates(islands: &[Vec<Island>], fills: &[Vec<Fills>], layers: &Layers, s: &Settings) -> Candidates {
    Candidates(par::map_range(fills.len(), |l| layer_candidates(l, islands, fills, layers, s)))
}

/// A bridge made of a candidate: its island, its area and the way its threads run (radians).
struct Bridge {
    island: usize,
    area: Shapes,
    angle: f64,
}

/// Every layer's fills with Orca's internal bridges, made of `candidates` (from these fills). `lines(layer, island,
/// sparse)` gives the sparse infill lines an island of a layer prints in that area.
pub fn bridge_over_infill(
    islands: &[Vec<Island>],
    fills: Vec<Vec<Fills>>,
    candidates: Candidates,
    layers: &Layers,
    lines: &SparseLines,
    s: &Settings,
) -> Vec<Vec<Fills>> {
    let n = fills.len();
    let candidates = candidates.0;
    // The thick bridge Orca measures with (whatever the bridges print as): a round thread, its height 0.9 of which
    // decides how deep the sparse infill under it must be.
    let (thread, _, thread_spacing) = {
        let mut thick = s.clone();
        thick.thick_internal_bridges = true;
        thick.bridge_flow(true, s.layer_height)
    };
    let reach_down = thread * 0.9;
    // Layers with candidates, in runs of neighbours close enough that a bridge on one takes from the next one's
    // sparse infill: each run in order, the runs side by side.
    let with: Vec<usize> = (0..n).filter(|&l| !candidates[l].is_empty()).collect();
    let mut runs: Vec<Vec<usize>> = Vec::new();
    for &l in &with {
        match runs.last_mut() {
            Some(run) if layers.top[*run.last().unwrap()] >= layers.top[l] - reach_down - 1e-4 => run.push(l),
            _ => runs.push(vec![l]),
        }
    }
    let made: Vec<Vec<(usize, Vec<Bridge>)>> = par::map_range(runs.len(), |r| {
        let mut out: Vec<(usize, Vec<Bridge>)> = Vec::new();
        for &l in &runs[r] {
            let below = out.last().filter(|(k, _)| *k + 1 == l).map(|(_, b)| b.as_slice());
            let bridges =
                bridges_on(l, &candidates[l], below, islands, &fills, layers, lines, (thread, thread_spacing), s);
            out.push((l, bridges));
        }
        out
    });
    let mut bridges: Vec<Vec<Bridge>> = (0..n).map(|_| Vec::new()).collect();
    for (l, b) in made.into_iter().flatten() {
        bridges[l] = b;
    }
    par::map_range(n, |l| {
        let mut layer = fills[l].clone();
        if bridges[l].is_empty() && bridges.get(l + 1).is_none_or(|b| b.is_empty()) {
            return layer;
        }
        let cut: Shapes = geom::union_all(&bridges[l].iter().map(|b| &b.area).collect::<Vec<_>>());
        // Under the edge of a bridge on the next layer, along the walls, solid infill.
        let mut ensuring: Shapes = Vec::new();
        if let Some(above) = bridges.get(l + 1).filter(|b| !b.is_empty()) {
            let sp_above = solid_spacing(l + 1, layers, s);
            let rings: Vec<Shapes> =
                above.iter().map(|b| geom::difference(&b.area, &geom::offset(&b.area, -sp_above))).collect();
            let rings = geom::union_all(&rings.iter().collect::<Vec<_>>());
            let area: Shapes = islands[l].iter().flat_map(|island| island.inner.iter().cloned()).collect();
            let near_walls = geom::difference(&area, &geom::offset(&area, -solid_spacing(l, layers, s)));
            ensuring = geom::intersection(&rings, &near_walls);
        }
        for (k, f) in layer.iter_mut().enumerate() {
            let Some(b) = geom::bbox(&islands[l][k].inner) else { continue };
            let (cut, ensuring) = (geom::near(&cut, b), geom::near(&ensuring, b));
            if cut.is_empty() && ensuring.is_empty() {
                continue;
            }
            // What the walls' ring takes is sparse or solid infill only.
            let ensuring = if ensuring.is_empty() {
                ensuring
            } else {
                geom::intersection(&ensuring, &geom::union(&f.sparse, &f.solid))
            };
            let take = |area: &Shapes| -> Shapes {
                let area = if cut.is_empty() { area.clone() } else { geom::difference(area, &cut) };
                if ensuring.is_empty() { area } else { geom::difference(&area, &ensuring) }
            };
            f.sparse = take(&f.sparse);
            let solid = take(&f.solid);
            f.solid = if ensuring.is_empty() { solid } else { geom::union(&solid, &ensuring) };
            for bridge in bridges[l].iter().filter(|b| b.island == k) {
                for shape in geom::union_all(&[&bridge.area]) {
                    f.internal_bridge.push(shape);
                    f.internal_bridge_angles.push(bridge.angle.to_degrees());
                }
            }
        }
        layer
    })
}

fn solid_spacing(l: usize, layers: &Layers, s: &Settings) -> f64 {
    Settings::spacing(if l == 0 { s.first_layer_width } else { s.solid_infill_width }, layers.height[l])
}

/// The layer's solid infill worth bridging: where it rests on the layer below's sparse infill, a good way in from
/// that infill's edge and from its solid infill, either all of it or more than a few lines' square of it; with
/// some room round that, and the small pieces of the rest that would be left between.
fn layer_candidates(
    l: usize,
    islands: &[Vec<Island>],
    fills: &[Vec<Fills>],
    layers: &Layers,
    s: &Settings,
) -> Vec<Candidate> {
    if l == 0 || fills[l].iter().all(|f| f.solid.is_empty()) {
        return Vec::new();
    }
    // Nothing to bridge where no solid infill lies over sparse infill below.
    if s.sparse_density >= 1.0 {
        return Vec::new();
    }
    let sparse_below: Shapes = fills[l - 1].iter().flat_map(|f| f.sparse.iter().cloned()).collect();
    let over = |f: &Fills| f.solid.iter().any(|shape| !geom::near(&sparse_below, geom::bbox_of(shape)).is_empty());
    if sparse_below.is_empty() || !fills[l].iter().any(over) {
        return Vec::new();
    }
    let sp = solid_spacing(l, layers, s);
    let area_below: Shapes = islands[l - 1].iter().flat_map(|island| island.inner.iter().cloned()).collect();
    let mut unsupported = geom::offset(&area_below, -3.0 * sp);
    if unsupported.is_empty() {
        return Vec::new();
    }
    let solids_below: Vec<&Shapes> = fills[l - 1]
        .iter()
        .flat_map(|f| {
            let sparse = (s.sparse_density >= 1.0).then_some(&f.sparse);
            [&f.top, &f.bottom, &f.bridge, &f.internal_bridge, &f.solid].into_iter().chain(sparse)
        })
        .filter(|shapes| !shapes.is_empty())
        .collect();
    if !solids_below.is_empty() {
        let solids = geom::simplify_shapes(&geom::union_all(&solids_below), RESOLUTION);
        let solids = geom::offset(&solids, -sp);
        if !solids.is_empty() {
            unsupported = geom::difference(&unsupported, &geom::offset(&solids, 4.0 * sp));
        }
    }
    let mut out = Vec::new();
    for (k, f) in fills[l].iter().enumerate() {
        for shape in &f.solid {
            let one = vec![shape.clone()];
            let theirs = geom::near(&unsupported, geom::bbox_of(shape));
            if theirs.is_empty() {
                continue;
            }
            let unsupported = geom::intersection(&one, &theirs);
            if unsupported.is_empty() {
                continue;
            }
            let area = geom::area_mm2(&unsupported);
            let partly = area < geom::shape_area_mm2(shape) - 1e-9;
            if partly && area <= 9.0 * sp * sp {
                continue;
            }
            let mut worth = geom::intersection(&one, &geom::offset(&unsupported, 4.0 * sp));
            // Small pieces of the rest go with it rather than break the solid infill up.
            for piece in geom::difference(&one, &geom::offset(&worth, sp)) {
                let outer = vec![vec![piece[0].clone()]];
                let a = geom::area_mm2(&outer);
                if a > sp * sp && a < sp * 12.0 {
                    worth.extend(outer);
                }
            }
            let worth = geom::intersection(&geom::union_all(&[&worth]), &one);
            if !worth.is_empty() {
                out.push(Candidate { island: k, area: worth });
            }
        }
    }
    out
}

/// The bridges a layer's candidates make (Orca's expansion of them): each over the sparse infill deep enough under
/// it, crossing the sparse lines below and reaching to the nearest of them at both ends.
#[allow(clippy::too_many_arguments)]
fn bridges_on(
    l: usize,
    candidates: &[Candidate],
    below: Option<&[Bridge]>,
    islands: &[Vec<Island>],
    fills: &[Vec<Fills>],
    layers: &Layers,
    lines: &SparseLines,
    (thread, sp): (f64, f64),
    s: &Settings,
) -> Vec<Bridge> {
    // Sparse infill under the layer, as deep as a thick thread would sink, less what bridges there took.
    let reach_down = thread * 0.9;
    let floor = layers.top[l] - reach_down - 1e-4;
    let (mut sparse, mut other): (Vec<&Shapes>, Vec<&Shapes>) = (Vec::new(), Vec::new());
    let mut i = l;
    while i > 0 {
        i -= 1;
        if layers.top[i] < floor && i + 1 < l {
            break;
        }
        for f in &fills[i] {
            if s.sparse_density < 1.0 {
                sparse.push(&f.sparse);
            } else {
                other.push(&f.sparse);
            }
            other.extend([&f.top, &f.bottom, &f.bridge, &f.internal_bridge, &f.solid]);
        }
    }
    sparse.retain(|shapes| !shapes.is_empty());
    other.retain(|shapes| !shapes.is_empty());
    let mut deep = if sparse.is_empty() { Vec::new() } else { geom::union_all(&sparse) };
    if !other.is_empty() && !deep.is_empty() {
        deep = geom::difference(&deep, &geom::union_all(&other));
    }
    if let Some(below) = below.filter(|_| layers.top[l - 1] >= floor) {
        let taken: Vec<&Shapes> = below.iter().map(|b| &b.area).collect();
        if !taken.is_empty() && !deep.is_empty() {
            deep = geom::difference(&deep, &geom::union_all(&taken));
        }
    }
    if deep.is_empty() {
        return Vec::new();
    }
    let deep = geom::offset(&deep, 1.5 * sp);
    // Room to reach into: this layer's sparse and solid infill over that.
    let own: Vec<&Shapes> = fills[l].iter().flat_map(|f| [&f.sparse, &f.solid]).filter(|a| !a.is_empty()).collect();
    let mut room = if own.is_empty() { Vec::new() } else { geom::intersection(&geom::union_all(&own), &deep) };
    let total: Shapes = islands[l].iter().flat_map(|island| island.inner.iter().cloned()).collect();
    let tops: Shapes = fills[l].iter().flat_map(|f| f.top.iter().cloned()).collect();
    // The sparse lines below, where they lie under that room: what the threads hold on to.
    let held = geom::offset(&room, -sp);
    let mut anchors: Vec<(Pt, Pt)> = Vec::new();
    if !held.is_empty() {
        for (k, f) in fills[l - 1].iter().enumerate() {
            if f.sparse.is_empty() {
                continue;
            }
            let Some(b) = geom::bbox(&f.sparse) else { continue };
            let near = geom::near(&held, b);
            if near.is_empty() {
                continue;
            }
            for line in fill::clip_polylines(&lines(l - 1, k, &f.sparse), &near) {
                anchors.extend(line.windows(2).filter(|w| w[0] != w[1]).map(|w| (w[0], w[1])));
            }
        }
    }
    let unsupported = geom::offset(&deep, -4.5 * sp);
    let walls = segments(&geom::offset(&total, 1.3 * sp));
    // Candidates from the left, then by how near they are to the first one.
    let boxes: Vec<[i32; 4]> = candidates.iter().map(|c| geom::bbox(&c.area).unwrap_or([0; 4])).collect();
    let mut keyed: Vec<([f64; 4], usize)> =
        boxes.iter().enumerate().map(|(c, b)| ([b[0] as f64, b[1] as f64, 0.0, 0.0], c)).collect();
    fill::sort_keyed(&mut keyed);
    if keyed.len() > 2 {
        let first = boxes[keyed[0].1];
        let origin = (first[2] as f64, first[3] as f64);
        for entry in &mut keyed[1..] {
            let b = boxes[entry.1];
            entry.0 = [(origin.0 - b[0] as f64).powi(2) + (origin.1 - b[1] as f64).powi(2), 0.0, 0.0, 0.0];
        }
        fill::sort_keyed(&mut keyed[1..]);
    }
    let order: Vec<usize> = keyed.into_iter().map(|(_, c)| c).collect();
    let mut out: Vec<Bridge> = Vec::new();
    for c in order {
        let candidate = &candidates[c];
        let grown = geom::offset(&candidate.area, sp);
        let Some(gb) = geom::bbox(&grown) else { continue };
        let pieces = geom::intersection(&grown, &geom::near(&deep, gb));
        let unsupported_near = geom::near(&unsupported, gb);
        let area: Shapes = pieces
            .into_iter()
            .filter(|piece| !geom::intersection(&vec![piece.clone()], &unsupported_near).is_empty())
            .collect();
        if area.is_empty() {
            continue;
        }
        let limit = geom::union(&area, &room);
        let mut boundary = walls.clone();
        boundary.extend(segments(&geom::offset(&limit, 0.3 * sp)));
        let mut angle = bridging_angle(&area, if anchors.is_empty() { &boundary } else { &anchors });
        boundary.extend(anchors.iter().copied());
        let mut bridge = anchored(&area, &boundary, thread, sp, angle);
        let reach = geom::offset(&bridge, 3.0 * sp);
        if let Some(other) = out.iter().find(|b| !geom::intersection(&b.area, &reach).is_empty()) {
            angle = other.angle;
            bridge = anchored(&area, &boundary, thread, sp, angle);
        }
        let mut bridge = geom::closing(&geom::opening(&bridge, 0.75 * sp), sp);
        if !bridge.is_empty() {
            bridge = geom::intersection(&geom::intersection(&bridge, &limit), &total);
            if !tops.is_empty() {
                bridge = geom::difference(&bridge, &tops);
            }
        }
        if !bridge.is_empty() {
            room = geom::difference(&room, &bridge);
        }
        out.push(Bridge { island: candidate.island, area: bridge, angle });
    }
    out
}

/// Every edge of the shapes' contours.
fn segments(shapes: &Shapes) -> Vec<(Pt, Pt)> {
    let mut out = Vec::new();
    for contour in shapes.iter().flatten() {
        let n = contour.len();
        for i in 0..n {
            let (a, b) = (contour[i], contour[(i + 1) % n]);
            if a != b {
                out.push((a, b));
            }
        }
    }
    out
}

/// The way a bridge's threads should run (radians, Orca's `determine_bridging_angle`): square to the lines nearest
/// its edge, sampled about every 2 mm along it, in the direction most of them agree on within a tenth of a turn.
fn bridging_angle(area: &Shapes, lines: &[(Pt, Pt)]) -> f64 {
    if lines.is_empty() {
        return 0.001;
    }
    let step = 2.0 * geom::SCALE;
    let mut counted: Vec<f64> = Vec::new();
    for contour in area.iter().flatten() {
        let mut travelled = 0.0;
        for w in contour.windows(2) {
            let (start, next) = ((w[0].x as f64, w[0].y as f64), (w[1].x as f64, w[1].y as f64));
            let v = (next.0 - start.0, next.1 - start.1);
            let len = v.0.hypot(v.1);
            travelled += len;
            if travelled <= step {
                continue;
            }
            travelled = 0.0;
            let v = (v.0 / len, v.1 / len);
            let count = (len / step).ceil() as usize;
            let each = len / count as f64;
            for i in 0..count {
                let q = ((start.0 + v.0 * (i as f64 * each)).trunc(), (start.1 + v.1 * (i as f64 * each)).trunc());
                let (a, b) = nearest(lines, q);
                let mut angle = ((b.y - a.y) as f64).atan2((b.x - a.x) as f64);
                if angle < 0.0 {
                    angle += 2.0 * PI;
                }
                if angle > PI {
                    angle -= PI;
                }
                counted.push(angle + PI * 0.5);
            }
        }
    }
    if counted.is_empty() {
        return 0.001;
    }
    counted.sort_by(f64::total_cmp);
    // Distinct directions with how often each came up.
    let mut dirs: Vec<(f64, usize)> = Vec::new();
    for a in counted {
        match dirs.last_mut() {
            Some((d, n)) if *d == a => *n += 1,
            _ => dirs.push((a, 1)),
        }
    }
    let mut best = (0.0, 0usize);
    for &(dir, _) in &dirs {
        let (from, to) = (dir - PI * 0.1, dir + PI * 0.1);
        let (mut sum, mut score) = (0.0, 0usize);
        for &(d, n) in dirs.iter().filter(|(d, _)| *d >= from && *d <= to) {
            sum += d * n as f64;
            score += n;
        }
        // Directions run from a quarter to three quarters of a turn: near the start, those near the end count too.
        if from < 0.5 * PI {
            for &(d, n) in dirs.iter().filter(|(d, _)| *d >= 1.5 * PI - (0.5 * PI - from)) {
                sum += (d - PI) * n as f64;
                score += n;
            }
        }
        if score > best.1 {
            best = (sum / score as f64, score);
        }
    }
    if best.0 == 0.0 { 0.001 } else { best.0 }
}

/// The line nearest a point.
fn nearest(lines: &[(Pt, Pt)], q: (f64, f64)) -> (Pt, Pt) {
    let mut best = (f64::MAX, lines[0]);
    for &(a, b) in lines {
        let (ax, ay, bx, by) = (a.x as f64, a.y as f64, b.x as f64, b.y as f64);
        let (dx, dy) = (bx - ax, by - ay);
        let len2 = dx * dx + dy * dy;
        let t = if len2 > 0.0 { (((q.0 - ax) * dx + (q.1 - ay) * dy) / len2).clamp(0.0, 1.0) } else { 0.0 };
        let (px, py) = (ax + dx * t, ay + dy * t);
        let d2 = (q.0 - px).powi(2) + (q.1 - py).powi(2);
        if d2 < best.0 {
            best = (d2, (a, b));
        }
    }
    best.1
}

/// A bridge's area reaching out along its direction (Orca's `construct_anchored_polygon`): cut into strips a
/// thread's spacing wide along the threads, each strip's every stretch reaches past the nearest anchor line on
/// either side by a thread's width, and the strips are traced back into polygons.
fn anchored(area: &Shapes, anchors: &[(Pt, Pt)], thread: f64, sp: f64, angle: f64) -> Shapes {
    let aligning = -angle + PI * 0.5;
    let (sin, cos) = aligning.sin_cos();
    let rotate = |p: Pt| -> (i64, i64) {
        let (x, y) = (p.x as f64, p.y as f64);
        ((cos * x - sin * y).round() as i64, (cos * y + sin * x).round() as i64)
    };
    let contours: Vec<Vec<(i64, i64)>> =
        area.iter().flatten().map(|c| c.iter().map(|&p| rotate(p)).collect()).collect();
    let lines: Vec<((i64, i64), (i64, i64))> = anchors.iter().map(|&(a, b)| (rotate(a), rotate(b))).collect();
    let (scan, spacing, width) = ((sp * geom::SCALE) as i64, sp * geom::SCALE, thread * geom::SCALE);
    if scan <= 0 || contours.is_empty() {
        return Vec::new();
    }
    let mut bx = (i64::MAX, i64::MIN);
    for &(x, _) in contours.iter().flatten() {
        bx = (bx.0.min(x), bx.1.max(x));
    }
    let n = ((bx.1 - bx.0 + scan - 1) / scan).max(0) as usize;
    let (x_lo, x_hi) = (bx.0, bx.0 + n as i64 * scan);
    let lines: Vec<((i64, i64), (i64, i64))> =
        lines.into_iter().filter(|(a, b)| a.0.max(b.0) >= x_lo && a.0.min(b.0) <= x_hi).collect();
    // Each strip's stretches inside the area, reaching to the anchors: (low y, high y).
    let mut strips: Vec<Vec<(i64, i64)>> = Vec::with_capacity(n);
    let mut ys: Vec<f64> = Vec::new();
    let mut hits: Vec<f64> = Vec::new();
    for i in 0..n {
        let x = (bx.0 as f64 + (i as f64 + 0.5) * scan as f64).trunc();
        ys.clear();
        for c in &contours {
            let m = c.len();
            for k in 0..m {
                let (a, b) = (c[k], c[(k + 1) % m]);
                let (lo, hi) = if a.0 < b.0 { (a, b) } else { (b, a) };
                if (lo.0 as f64) <= x && x < hi.0 as f64 {
                    let t = (x - lo.0 as f64) / (hi.0 - lo.0) as f64;
                    ys.push(lo.1 as f64 + (hi.1 - lo.1) as f64 * t);
                }
            }
        }
        ys.sort_by(f64::total_cmp);
        hits.clear();
        for &(a, b) in &lines {
            let (lo, hi) = if a.0 <= b.0 { (a, b) } else { (b, a) };
            if (lo.0 as f64) <= x && x <= hi.0 as f64 {
                let y = if hi.0 == lo.0 {
                    lo.1.min(hi.1) as f64
                } else {
                    lo.1 as f64 + (hi.1 - lo.1) as f64 * (x - lo.0 as f64) / (hi.0 - lo.0) as f64
                };
                hits.push(y);
            }
        }
        hits.sort_by(f64::total_cmp);
        let mut sections: Vec<(i64, i64)> = Vec::new();
        for &[lo, hi] in ys.as_chunks::<2>().0 {
            let (mut lo, mut hi) = (lo, hi);
            if hi - lo <= 0.0 {
                continue;
            }
            // The nearest anchor below the stretch and above it.
            if let Some(&y) = hits.iter().rev().find(|&&y| y < lo) {
                lo = y - width;
            }
            if let Some(&y) = hits.iter().find(|&&y| y > hi) {
                hi = y + width;
            }
            sections.push((lo.round() as i64, hi.round() as i64));
        }
        // Stretches that now overlap become one.
        for k in 0..sections.len().saturating_sub(1) {
            let (a, b) = (sections[k], sections[k + 1]);
            if a.0 <= b.1 && b.0 <= a.1 {
                sections[k + 1] = (a.0.min(b.0), a.1.max(b.1));
                sections[k] = (a.1, a.1);
            }
        }
        sections.retain(|(lo, hi)| lo != hi);
        let mut keyed: Vec<([f64; 4], usize)> =
            sections.iter().enumerate().map(|(k, &(lo, hi))| ([lo as f64, hi as f64, 0.0, 0.0], k)).collect();
        fill::sort_keyed(&mut keyed);
        strips.push(keyed.into_iter().map(|(_, k)| sections[k]).collect());
    }
    // Trace the strips into polygons: each runs on while a stretch in the next strip overlaps its last one.
    struct Traced {
        lows: Vec<(i64, i64)>,
        highs: Vec<(i64, i64)>,
    }
    let half = scan / 2;
    let near2 = 36.0 * spacing * spacing;
    let mut polygons: Vec<Vec<(i64, i64)>> = Vec::new();
    let mut open: Vec<Traced> = Vec::new();
    for (i, strip) in strips.iter().enumerate() {
        let x = (bx.0 as f64 + (i as f64 + 0.5) * scan as f64).trunc() as i64;
        let mut used = vec![false; strip.len()];
        for t in open.iter_mut() {
            let (low, high) = (*t.lows.last().unwrap(), *t.highs.last().unwrap());
            let mut added = false;
            for (k, &(lo, hi)) in strip.iter().enumerate() {
                if added || used[k] || hi <= low.1 || lo > high.1 {
                    continue;
                }
                let (a, b) = ((x, lo), (x, hi));
                let d2 = |p: (i64, i64), q: (i64, i64)| ((p.0 - q.0) as f64).powi(2) + ((p.1 - q.1) as f64).powi(2);
                if d2(low, a) < near2 {
                    t.lows.push(a);
                } else {
                    t.lows.extend([(low.0 + half, low.1), (a.0 - half, a.1), a]);
                }
                if d2(high, b) < near2 {
                    t.highs.push(b);
                } else {
                    t.highs.extend([(high.0 + half, high.1), (b.0 - half, b.1), b]);
                }
                used[k] = true;
                added = true;
            }
            if !added {
                t.lows.push((low.0 + half, low.1));
                t.highs.push((high.0 + half, high.1));
                let mut polygon = std::mem::take(&mut t.lows);
                polygon.extend(t.highs.drain(..).rev());
                polygons.push(polygon);
            }
        }
        open.retain(|t| !t.lows.is_empty());
        for (k, &(lo, hi)) in strip.iter().enumerate() {
            if !used[k] {
                open.push(Traced { lows: vec![(x - half, lo), (x, lo)], highs: vec![(x - half, hi), (x, hi)] });
            }
        }
    }
    for t in open {
        let mut polygon = t.lows;
        polygon.extend(t.highs.into_iter().rev());
        polygons.push(polygon);
    }
    // Back from the strips' frame.
    let (sin, cos) = (-aligning).sin_cos();
    let contours: Vec<Vec<Pt>> = polygons
        .into_iter()
        .filter(|p| p.len() >= 3)
        .map(|p| {
            p.into_iter()
                .map(|(x, y)| {
                    let (x, y) = (x as f64, y as f64);
                    geom::pt((cos * x - sin * y).round() as i32, (cos * y + sin * x).round() as i32)
                })
                .collect()
        })
        .collect();
    geom::union_contours(&contours)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x0: f64, y0: f64, x1: f64, y1: f64) -> Vec<Pt> {
        let p = |x: f64, y: f64| geom::pt(geom::sc(x), geom::sc(y));
        vec![p(x0, y0), p(x1, y0), p(x1, y1), p(x0, y1)]
    }

    #[test]
    fn a_bridge_reaches_to_the_lines_it_rests_on() {
        // A 4 mm square to bridge, its threads running along y, with anchor lines along x at y = -1 and y = 6.
        let area = vec![vec![rect(0.0, 0.0, 4.0, 4.0)]];
        let line = |y: f64| (geom::pt(geom::sc(-5.0), geom::sc(y)), geom::pt(geom::sc(9.0), geom::sc(y)));
        let anchors = vec![line(-1.0), line(6.0)];
        let out = anchored(&area, &anchors, 0.4, 0.45, PI / 2.0);
        let b = geom::bbox(&out).unwrap();
        // It now runs from a thread's width past the lower line to a thread's width past the upper one.
        assert!((geom::unsc(b[1]) + 1.4).abs() < 0.01, "{}", geom::unsc(b[1]));
        assert!((geom::unsc(b[3]) - 6.4).abs() < 0.01, "{}", geom::unsc(b[3]));
        assert!(geom::unsc(b[0]) > -0.5 && geom::unsc(b[2]) < 4.6);
    }

    #[test]
    fn bridges_cross_the_lines_under_them() {
        // Lines along x everywhere round the area: the threads run along y.
        let area = vec![vec![rect(0.0, 0.0, 10.0, 10.0)]];
        let lines: Vec<(Pt, Pt)> = (-2..14)
            .map(|k| (geom::pt(geom::sc(-3.0), geom::sc(k as f64)), geom::pt(geom::sc(13.0), geom::sc(k as f64))))
            .collect();
        let angle = bridging_angle(&area, &lines);
        assert!((angle - PI / 2.0).abs() < 0.01, "{angle}");
    }
}
