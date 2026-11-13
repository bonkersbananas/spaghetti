//! Each layer's extrusions in print order: island by island (nearest first), inner walls, then the outer wall, then
//! the infill (bridges, bottom, solid, sparse, top), every group nearest first. Walls are counter-clockwise loops
//! that start at the island's rear (a seam that lines up layer to layer). Widths, flows, speeds and accelerations
//! are Orca's for the role; speeds are capped by the filament's volumetric limit.

use crate::config::Settings;
use crate::geom::{self, Contour, Pt};
use crate::infill;
use crate::region::{Fills, LayerRegions, Role};
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

/// Layer `i`'s extrusions in print order.
pub fn plan_layer(r: &LayerRegions, i: usize, layers: &Layers, s: &Settings) -> LayerPlan {
    let z = layers.top[i];
    let h = layers.height[i];
    // Alternate the corner each layer starts from, so a layer begins near where the last one likely ended.
    let start = if i.is_multiple_of(2) { geom::pt(0, 0) } else { geom::pt(geom::sc(s.bed[0]), geom::sc(s.bed[1])) };
    let mut per_island: Vec<Vec<Path>> = r
        .islands
        .iter()
        .zip(&r.fills)
        .enumerate()
        .map(|(k, (island, fills))| island_paths(k as u32, &island.walls, fills, i, h, s))
        .collect();
    // Islands nearest first.
    let mut order = Vec::with_capacity(per_island.len());
    let mut done = vec![false; per_island.len()];
    let mut at = start;
    for _ in 0..per_island.len() {
        let mut best: Option<(usize, f64)> = None;
        for (k, paths) in per_island.iter().enumerate() {
            if done[k] || paths.is_empty() {
                continue;
            }
            let d = geom::dist(at, paths[0].points[0]);
            if best.is_none_or(|(_, bd)| d < bd) {
                best = Some((k, d));
            }
        }
        let Some((k, _)) = best else { break };
        done[k] = true;
        order.push(k);
        if let Some(last) = per_island[k].last() {
            at = *last.points.last().unwrap();
        }
    }
    let mut paths = Vec::new();
    for k in order {
        paths.append(&mut per_island[k]);
    }
    LayerPlan { index: i, z, height: h, paths }
}

fn island_paths(island: u32, walls: &[Vec<Contour>], fills: &Fills, layer: usize, h: f64, s: &Settings) -> Vec<Path> {
    let first = layer == 0;
    let mut out: Vec<Path> = Vec::new();
    let mut at: Option<Pt> = None;

    // Inner walls, innermost first, then the outer walls.
    for depth in (0..walls.len()).rev() {
        let role = if depth == 0 { Role::OuterWall } else { Role::InnerWall };
        let mut loops: Vec<Vec<Pt>> = walls[depth].iter().map(seam_loop).collect();
        order_loops(&mut loops, &mut at);
        for points in loops {
            out.push(path(role, points, true, island, first, h, s));
        }
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
    Path { role, points, closed, width, mm3_per_mm, speed, accel: accel(role, first, s), island }
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
