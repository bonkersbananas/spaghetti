//! Each layer's extrusions in print order: object by object and island by island (nearest first), inner walls,
//! then the outer wall, then the infill (bridges, bottom, solid, sparse, top), every group nearest first. Walls are
//! counter-clockwise loops that start at the island's rear (a seam that lines up layer to layer). Widths, flows,
//! speeds and accelerations are Orca's for the role; speeds are capped by the filament's volumetric limit.

use crate::config::Settings;
use crate::fill;
use crate::geom::{self, Contour, Pt, Shapes};
use crate::infill;
use crate::medial;
use crate::region::{self, Fills, Island, LayerRegions, Role};
use crate::section::Layers;

#[derive(Clone, Debug)]
pub struct Path {
    pub role: Role,
    /// A loop repeats its first point at the end.
    pub points: Vec<Pt>,
    pub closed: bool,
    pub width: f64,
    pub mm3_per_mm: f64,
    /// mm/s, before any slowing down for a short layer.
    pub speed: f64,
    pub accel: f64,
    pub island: u32,
    /// Which of the plate's objects it belongs to (an index into them).
    pub object: u32,
}

pub struct LayerPlan {
    pub index: usize,
    pub z: f64,
    pub height: f64,
    pub paths: Vec<Path>,
}

/// The kind of each infill region, in the order they print.
const FILL_ORDER: [Role; 6] =
    [Role::Bridge, Role::InternalBridge, Role::BottomSurface, Role::SolidInfill, Role::SparseInfill, Role::TopSurface];

/// Layer `i`'s extrusions in print order: object by object, the nearest island first and the rest of its object's
/// islands nearest first, so each object's moves come together (the printer can skip an object only so). `centres`
/// are the middles of the objects' bounding boxes on the plate (units), where their infill patterns are anchored.
pub fn plan_layer(r: &LayerRegions, i: usize, layers: &Layers, centres: &[(f64, f64)], s: &Settings) -> LayerPlan {
    let z = layers.top[i];
    let h = layers.height[i];
    // Alternate the corner each layer starts from, so a layer begins near where the last one likely ended.
    let start = if i.is_multiple_of(2) { geom::pt(0, 0) } else { geom::pt(geom::sc(s.bed[0]), geom::sc(s.bed[1])) };
    let mut per_island: Vec<Vec<Path>> = r
        .islands
        .iter()
        .zip(&r.fills)
        .enumerate()
        .map(|(k, (island, fills))| {
            let centre = centres.get(island.object as usize).copied().unwrap_or((0.0, 0.0));
            island_paths(k as u32, island, fills, i, (z, h), centre, s)
        })
        .collect();
    let owner: Vec<u32> = r.islands.iter().map(|island| island.object).collect();
    let mut order = Vec::with_capacity(per_island.len());
    let mut done = vec![false; per_island.len()];
    let mut at = start;
    let mut object: Option<u32> = None;
    for _ in 0..per_island.len() {
        // The nearest island of the object being printed, else the nearest of any.
        let nearest = |of: Option<u32>| {
            let mut best: Option<(usize, f64)> = None;
            for (k, paths) in per_island.iter().enumerate() {
                if done[k] || paths.is_empty() || of.is_some_and(|o| owner[k] != o) {
                    continue;
                }
                let d = geom::dist(at, paths[0].points[0]);
                if best.is_none_or(|(_, bd)| d < bd) {
                    best = Some((k, d));
                }
            }
            best
        };
        let Some((k, _)) = nearest(object).or_else(|| nearest(None)) else { break };
        done[k] = true;
        order.push(k);
        object = Some(owner[k]);
        if let Some(last) = per_island[k].last() {
            at = *last.points.last().unwrap();
        }
    }
    let mut paths = Vec::new();
    for k in order {
        for p in &mut per_island[k] {
            p.object = owner[k];
        }
        paths.append(&mut per_island[k]);
    }
    LayerPlan { index: i, z, height: h, paths }
}

fn island_paths(
    index: u32,
    island: &Island,
    fills: &Fills,
    layer: usize,
    (z, h): (f64, f64),
    centre: (f64, f64),
    s: &Settings,
) -> Vec<Path> {
    let first = layer == 0;
    let (walls, gaps) = (&island.walls, &island.gaps);
    let mut out: Vec<Path> = Vec::new();
    let mut at: Option<Pt> = None;
    let island = index;

    // Inner walls, innermost first, then the outer walls.
    for depth in (0..walls.len()).rev() {
        let role = if depth == 0 { Role::OuterWall } else { Role::InnerWall };
        let mut loops: Vec<Vec<Pt>> = walls[depth].iter().map(seam_loop).collect();
        order_loops(&mut loops, &mut at);
        for points in loops {
            out.push(path(role, points, true, island, first, h, s));
        }
    }

    // Gap fill along the middle of the gaps between walls, as wide as each gap is there.
    let (gap_min, gap_max) = region::gap_widths(layer, h, s);
    let mut lines: Vec<medial::ThickLine> =
        gaps.iter().flat_map(|shape| medial::axis(shape, gap_min, gap_max)).collect();
    order_thick(&mut lines, &mut at);
    for line in lines {
        out.extend(gap_fill(line, island, first, h, s));
    }

    for role in FILL_ORDER {
        let (region, overlap) = match role {
            Role::Bridge => (&fills.bridge, s.top_bottom_infill_wall_overlap),
            Role::InternalBridge => (&fills.internal_bridge, s.infill_wall_overlap),
            Role::BottomSurface => (&fills.bottom, s.top_bottom_infill_wall_overlap),
            Role::SolidInfill => (&fills.solid, s.infill_wall_overlap),
            Role::SparseInfill => (&fills.sparse, s.infill_wall_overlap),
            Role::TopSurface => (&fills.top, s.top_bottom_infill_wall_overlap),
            _ => continue,
        };
        if region.is_empty() {
            continue;
        }
        if let (Role::SparseInfill, Some(pattern)) = (role, fill::Pattern::of(&s.sparse_infill_pattern)) {
            let mut runs = sparse_runs(region, pattern, z, h, centre, s);
            order_runs(&mut runs, &mut at);
            for points in runs {
                out.push(path(role, points, false, island, first, h, s));
            }
            continue;
        }
        let (width, _, _) = flow(role, first, h, s);
        let grown = geom::offset(region, overlap * width);
        let solid_angle =
            if layer.is_multiple_of(2) { s.solid_infill_direction } else { s.solid_infill_direction + 90.0 };
        let (angle, spacing) = match role {
            Role::SparseInfill => {
                let angle = if layer.is_multiple_of(2) { s.infill_direction } else { s.infill_direction + 90.0 };
                (angle, Settings::spacing(width, h) / s.sparse_density)
            }
            Role::InternalBridge => (solid_angle, s.nozzle_diameter + 0.05),
            _ => (solid_angle, Settings::spacing(width, h)),
        };
        let mut runs = infill::fill(&grown, angle, spacing, 0.0);
        order_runs(&mut runs, &mut at);
        for points in runs {
            if points.len() >= 2 {
                out.push(path(role, points, false, island, first, h, s));
            }
        }
    }
    out
}

/// Sparse infill in Orca's pattern (`fill.rs`), where Orca puts its lines' middles: into the walls by Orca's
/// overlap (a share of half the last wall's and half a solid line's spacing), less half the infill's spacing.
fn sparse_runs(
    region: &Shapes,
    pattern: fill::Pattern,
    z: f64,
    h: f64,
    centre: (f64, f64),
    s: &Settings,
) -> Vec<Vec<Pt>> {
    let inset = match s.wall_loops {
        0 => 0.0,
        1 => Settings::spacing(s.outer_wall_width, h) / 2.0,
        _ => Settings::spacing(s.inner_wall_width, h) / 2.0,
    };
    let overlap = if inset > 0.0 {
        s.infill_wall_overlap * (inset + Settings::spacing(s.solid_infill_width, h) / 2.0)
    } else {
        0.0
    };
    // Orca spaces sparse lines for the object's layer height, so they line up from layer to layer.
    let spacing = Settings::spacing(s.sparse_infill_width, s.layer_height);
    let params = fill::Sparse {
        pattern,
        origin: centre,
        z,
        angle: s.infill_direction,
        spacing,
        density: s.sparse_density,
        anchor: s.infill_anchor,
        anchor_max: s.infill_anchor_max,
    };
    fill::sparse(region, overlap - spacing / 2.0, &params)
}

/// A gap's line as paths, each a stretch of about the same width (within 15 %), flow to match.
fn gap_fill(line: medial::ThickLine, island: u32, first: bool, h: f64, s: &Settings) -> Vec<Path> {
    let mut out = Vec::new();
    let n = line.points.len();
    let mut start = 0;
    while start + 1 < n {
        // The stretch from `start`: segments while their width stays near the first one's.
        let first_w = (line.widths[start] + line.widths[start + 1]) / 2.0;
        let mut end = start + 1;
        let mut sum = first_w * geom::dist(line.points[start], line.points[end]);
        let mut length = geom::dist(line.points[start], line.points[end]);
        while end + 1 < n {
            let w = (line.widths[end] + line.widths[end + 1]) / 2.0;
            if (w - first_w).abs() > first_w * 0.15 {
                break;
            }
            let l = geom::dist(line.points[end], line.points[end + 1]);
            sum += w * l;
            length += l;
            end += 1;
        }
        let width = if length > 0.0 { sum / length } else { first_w };
        let mm3_per_mm = Settings::mm3_per_mm(width, h).max(width * h * 0.5);
        let speed = if first { s.first_layer_infill_speed } else { s.gap_infill_speed };
        out.push(Path {
            role: Role::GapFill,
            points: line.points[start..=end].to_vec(),
            closed: false,
            width,
            mm3_per_mm,
            speed: speed.min(s.speed_cap(mm3_per_mm)),
            accel: if first { s.first_layer_accel } else { s.default_accel },
            island,
            object: 0,
        });
        start = end;
    }
    out
}

/// Gap lines nearest first, each entered from its nearer end.
fn order_thick(lines: &mut Vec<medial::ThickLine>, at: &mut Option<Pt>) {
    if lines.is_empty() {
        return;
    }
    let mut rest = std::mem::take(lines);
    let mut cur = at.unwrap_or(rest[0].points[0]);
    while !rest.is_empty() {
        let mut best = (0usize, f64::INFINITY, false);
        for (k, l) in rest.iter().enumerate() {
            let d0 = geom::dist(cur, l.points[0]);
            let d1 = geom::dist(cur, *l.points.last().unwrap());
            if d0 < best.1 {
                best = (k, d0, false);
            }
            if d1 < best.1 {
                best = (k, d1, true);
            }
        }
        let mut l = rest.swap_remove(best.0);
        if best.2 {
            l.points.reverse();
            l.widths.reverse();
        }
        cur = *l.points.last().unwrap();
        lines.push(l);
    }
    *at = Some(cur);
}

/// Width, mm³ per mm and nominal speed of a role on this layer.
pub fn flow(role: Role, first: bool, h: f64, s: &Settings) -> (f64, f64, f64) {
    if first {
        let w = s.first_layer_width;
        let speed = if role.is_infill() { s.first_layer_infill_speed } else { s.first_layer_speed };
        return (w, Settings::mm3_per_mm(w, h), speed);
    }
    let (w, speed) = match role {
        Role::OuterWall => (s.outer_wall_width, s.outer_wall_speed),
        Role::InnerWall => (s.inner_wall_width, s.inner_wall_speed),
        Role::SparseInfill => (s.sparse_infill_width, s.sparse_infill_speed),
        Role::SolidInfill => (s.solid_infill_width, s.solid_infill_speed),
        Role::TopSurface => (s.top_surface_width, s.top_surface_speed),
        Role::BottomSurface => (s.solid_infill_width, s.solid_infill_speed),
        Role::Bridge => (s.solid_infill_width, s.bridge_speed),
        Role::InternalBridge => (s.nozzle_diameter, s.internal_bridge_speed),
        Role::GapFill => (s.inner_wall_width, s.gap_infill_speed),
    };
    let mm3 = if role == Role::InternalBridge { s.bridge_mm3_per_mm() } else { Settings::mm3_per_mm(w, h) };
    (w, mm3, speed)
}

fn accel(role: Role, first: bool, s: &Settings) -> f64 {
    if first {
        return s.first_layer_accel;
    }
    match role {
        Role::OuterWall => s.outer_wall_accel,
        Role::InnerWall => s.inner_wall_accel,
        Role::TopSurface => s.top_surface_accel,
        Role::Bridge | Role::InternalBridge => s.bridge_accel,
        _ => s.default_accel,
    }
}

fn path(role: Role, points: Vec<Pt>, closed: bool, island: u32, first: bool, h: f64, s: &Settings) -> Path {
    let (width, mm3_per_mm, speed) = flow(role, first, h, s);
    let speed = speed.min(s.speed_cap(mm3_per_mm));
    Path { role, points, closed, width, mm3_per_mm, speed, accel: accel(role, first, s), island, object: 0 }
}

/// A wall loop as printed: counter-clockwise, from the rearmost point (largest y, then smallest x), closed.
fn seam_loop(contour: &Contour) -> Vec<Pt> {
    let mut points: Vec<Pt> = contour.clone();
    if geom::area2(&points) < 0 {
        points.reverse();
    }
    let seam = points
        .iter()
        .enumerate()
        .max_by(|(_, a), (_, b)| a.y.cmp(&b.y).then(b.x.cmp(&a.x)))
        .map(|(i, _)| i)
        .unwrap_or(0);
    points.rotate_left(seam);
    points.push(points[0]);
    points
}

/// Loops nearest first (a loop is entered at its seam).
fn order_loops(loops: &mut Vec<Vec<Pt>>, at: &mut Option<Pt>) {
    if loops.len() <= 1 {
        if let Some(l) = loops.last() {
            *at = l.last().copied();
        }
        return;
    }
    let mut rest = std::mem::take(loops);
    let mut cur = at.unwrap_or(rest[0][0]);
    while !rest.is_empty() {
        let (k, _) = rest
            .iter()
            .enumerate()
            .map(|(k, l)| (k, geom::dist(cur, l[0])))
            .min_by(|a, b| a.1.total_cmp(&b.1))
            .unwrap();
        let l = rest.swap_remove(k);
        cur = *l.last().unwrap();
        loops.push(l);
    }
    *at = Some(cur);
}

/// Open runs nearest first, each entered from whichever end is nearer.
fn order_runs(runs: &mut Vec<Vec<Pt>>, at: &mut Option<Pt>) {
    if runs.is_empty() {
        return;
    }
    let mut rest = std::mem::take(runs);
    let mut cur = at.unwrap_or(rest[0][0]);
    while !rest.is_empty() {
        let mut best = (0usize, f64::INFINITY, false);
        for (k, r) in rest.iter().enumerate() {
            let d0 = geom::dist(cur, r[0]);
            let d1 = geom::dist(cur, *r.last().unwrap());
            if d0 < best.1 {
                best = (k, d0, false);
            }
            if d1 < best.1 {
                best = (k, d1, true);
            }
        }
        let mut r = rest.swap_remove(best.0);
        if best.2 {
            r.reverse();
        }
        cur = *r.last().unwrap();
        runs.push(r);
    }
    *at = Some(cur);
}
