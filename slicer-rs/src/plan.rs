//! Each layer's extrusions in print order: object by object and island by island (nearest first), inner walls,
//! then the outer wall, then the infill (bridges, bottom, solid, sparse, top), every group nearest first. Walls are
//! counter-clockwise loops that start at the island's rear (a seam that lines up layer to layer). Widths, flows,
//! speeds and accelerations are Orca's for the role; speeds are capped by the filament's volumetric limit.

use crate::config::Settings;
use crate::fill;
use crate::geom::{self, Contour, Pt, Shapes};
use crate::infill;
use crate::medial;
use crate::monotonic;
use crate::region::{self, Fills, Island, LayerRegions, Role};
use crate::section::Layers;
use crate::solid;

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
    let island_inner = &island.inner;
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
        out.extend(thick_paths(Role::GapFill, &line.points, &line.widths, island, first, h, s));
    }

    // The infill reaches into the innermost wall, but not into the infill of other kinds beside it.
    let overlap = wall_overlap(layer, h, s);
    let into_walls = |region: &Shapes| -> Shapes {
        if overlap <= 0.0 || region.is_empty() {
            return region.clone();
        }
        let grown = geom::offset(region, overlap);
        // Alone in the island (the common case): nothing else to keep out of.
        if (geom::area_mm2(island_inner) - geom::area_mm2(region)).abs() < 1e-3 {
            return grown;
        }
        let others = geom::difference(island_inner, region);
        if others.is_empty() { grown } else { geom::difference(&grown, &others) }
    };
    let origin = (centre.0, centre.1);
    for role in FILL_ORDER {
        let region = match role {
            Role::Bridge => &fills.bridge,
            Role::InternalBridge => &fills.internal_bridge,
            Role::BottomSurface => &fills.bottom,
            Role::SolidInfill => &fills.solid,
            Role::SparseInfill => &fills.sparse,
            Role::TopSurface => &fills.top,
            _ => continue,
        };
        if region.is_empty() {
            continue;
        }
        if role == Role::SparseInfill {
            let mut runs = sparse_lines(region, layer, z, h, centre, s);
            order_runs(&mut runs, &mut at);
            for points in runs {
                if points.len() >= 2 {
                    out.push(path(role, points, false, island, first, h, s));
                }
            }
            continue;
        }
        let (width, _, _) = flow(role, first, h, s);
        let solid_angle =
            if layer.is_multiple_of(2) { s.solid_infill_direction } else { s.solid_infill_direction + 90.0 };
        // Each bridge spans its own way; everything else in a region fills at one angle.
        let angled = |shapes: &Shapes, angles: &[f64]| -> Vec<(Shapes, f64)> {
            shapes
                .iter()
                .zip(angles.iter().copied().chain(std::iter::repeat(solid_angle)))
                .map(|(shape, angle)| (vec![shape.clone()], angle))
                .collect()
        };
        let parts: Vec<(Shapes, f64)> = match role {
            Role::Bridge => angled(&fills.bridge, &fills.bridge_angles),
            Role::InternalBridge => angled(&fills.internal_bridge, &fills.internal_bridge_angles),
            _ => vec![(region.clone(), solid_angle)],
        };
        let bridge = matches!(role, Role::Bridge | Role::InternalBridge);
        let spacing =
            if bridge { s.bridge_flow(role == Role::InternalBridge, h).2 } else { Settings::spacing(width, h) };
        let style = solid_style(role, s);
        // Orca keeps each region's lines in the order its fill makes them, and starts with the nearest region.
        let mut groups: Vec<Vec<Path>> = Vec::new();
        for (part, angle) in parts {
            for shape in &into_walls(&part) {
                if role == Role::SolidInfill
                    && s.narrow_solid_loops
                    && let Some((normal, narrow)) = solid::split_narrow(shape, spacing, angle.to_radians())
                {
                    for n in &normal {
                        groups.push(solid_lines(n, role, style, angle, spacing, origin, island, first, h, s));
                    }
                    // Loops fill the narrow part inside the walls (Orca fills it without the overlap).
                    let room = geom::intersection(&narrow, &geom::local(island_inner, geom::bbox_of(shape)));
                    let near = geom::pt(origin.0.round() as i32, origin.1.round() as i32);
                    let mut group = Vec::new();
                    for p in solid::narrow_loops(&room, spacing, s.nozzle_diameter, near) {
                        group.extend(thick_paths(role, &p.points, &p.widths, island, first, h, s));
                    }
                    groups.push(group);
                    continue;
                }
                groups.push(solid_lines(shape, role, style, angle, spacing, origin, island, first, h, s));
            }
        }
        groups.retain(|g| !g.is_empty());
        let mut cur = at.unwrap_or(groups.first().map_or(geom::pt(0, 0), |g| g[0].points[0]));
        while !groups.is_empty() {
            let k = (0..groups.len())
                .min_by(|&a, &b| {
                    geom::dist(cur, groups[a][0].points[0]).total_cmp(&geom::dist(cur, groups[b][0].points[0]))
                })
                .unwrap();
            let group = groups.swap_remove(k);
            cur = *group.last().unwrap().points.last().unwrap();
            out.extend(group);
            at = Some(cur);
        }
    }
    out
}

/// How a kind of solid infill is laid: Orca's monotonic lines (joined along the edge, or for its "monotonic line"
/// pattern each on its own), else zig-zag. Bridges are monotonic where the top surface pattern is.
#[derive(Clone, Copy, PartialEq, Eq)]
enum SolidStyle {
    Monotonic { connect: bool },
    ZigZag,
}

fn solid_style(role: Role, s: &Settings) -> SolidStyle {
    let pattern = match role {
        Role::TopSurface => s.top_surface_pattern.as_str(),
        Role::BottomSurface => s.bottom_surface_pattern.as_str(),
        Role::SolidInfill => s.internal_solid_infill_pattern.as_str(),
        _ => match s.top_surface_pattern.as_str() {
            "monotonic" | "monotonicline" => "monotonic",
            _ => "rectilinear",
        },
    };
    match pattern {
        "monotonicline" => SolidStyle::Monotonic { connect: false },
        "monotonic" | "" => SolidStyle::Monotonic { connect: true },
        _ => SolidStyle::ZigZag,
    }
}

/// One region of solid infill (or a bridge) as lines `angle` degrees, in print order. Solid infill spreads its
/// lines over the region (Orca's `_adjust_solid_spacing`) and prints them as much wider; bridges keep their grid.
#[allow(clippy::too_many_arguments)]
fn solid_lines(
    shape: &geom::Shape,
    role: Role,
    style: SolidStyle,
    angle: f64,
    spacing: f64,
    origin: (f64, f64),
    island: u32,
    first: bool,
    h: f64,
    s: &Settings,
) -> Vec<Path> {
    let bridge = matches!(role, Role::Bridge | Role::InternalBridge);
    let mut out = Vec::new();
    if let SolidStyle::Monotonic { connect } = style {
        let params = monotonic::Params {
            direction: angle.to_radians(),
            spacing,
            adjust: !bridge,
            connect,
            // Orca joins solid lines along the edge up to three spacings; bridges any length.
            link_max: if bridge { 0.0 } else { 3.0 * spacing },
            origin,
        };
        if let Some(filled) = monotonic::fill(shape, &params) {
            let widen = filled.spacing - spacing;
            for points in filled.lines {
                let mut p = path(role, points, false, island, first, h, s);
                if widen > 1e-9 {
                    p.width += widen;
                    p.mm3_per_mm = Settings::mm3_per_mm(p.width, h);
                    p.speed = p.speed.min(s.speed_cap(p.mm3_per_mm));
                }
                out.push(p);
            }
            return out;
        }
    }
    let mut runs = infill::fill(&vec![shape.clone()], angle, spacing, 0.0);
    let mut at = None;
    order_runs(&mut runs, &mut at);
    for points in runs {
        if points.len() >= 2 {
            out.push(path(role, points, false, island, first, h, s));
        }
    }
    out
}

/// mm the infill reaches into the innermost wall: Orca's share (`infill_wall_overlap`, on the first layer
/// `top_bottom_infill_wall_overlap`) of half the last wall's spacing and half a solid line's.
fn wall_overlap(layer: usize, h: f64, s: &Settings) -> f64 {
    let first = layer == 0;
    let (w_outer, w_inner, w_solid) = if first {
        (s.first_layer_width, s.first_layer_width, s.first_layer_width)
    } else {
        (s.outer_wall_width, s.inner_wall_width, s.solid_infill_width)
    };
    let inset = match s.wall_loops {
        0 => return 0.0,
        1 => Settings::spacing(w_outer, h) / 2.0,
        _ => Settings::spacing(w_inner, h) / 2.0,
    };
    let share = if first { s.top_bottom_infill_wall_overlap } else { s.infill_wall_overlap };
    share * (inset + Settings::spacing(w_solid, h) / 2.0)
}

/// The sparse infill lines of a region on a layer, as printed: Orca's pattern where there is one, else straight
/// lines at the infill direction, turned a quarter every other layer.
pub fn sparse_lines(region: &Shapes, layer: usize, z: f64, h: f64, centre: (f64, f64), s: &Settings) -> Vec<Vec<Pt>> {
    if let Some(pattern) = fill::Pattern::of(&s.sparse_infill_pattern) {
        return sparse_runs(region, pattern, z, h, centre, s);
    }
    let (width, _, _) = flow(Role::SparseInfill, layer == 0, h, s);
    let grown = geom::offset(region, s.infill_wall_overlap * width);
    let angle = if layer.is_multiple_of(2) { s.infill_direction } else { s.infill_direction + 90.0 };
    infill::fill(&grown, angle, Settings::spacing(width, h) / s.sparse_density, 0.0)
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

/// A line of varying width as paths (Orca's `variable_width`): each a stretch whose width stays within 0.05 mm,
/// steps that change more split to that, at the stretch's average width. Widths are each line's share of the
/// region (the medial axis's and Arachne's), so a path takes width × height mm³ a mm, and Orca prints it that plus
/// h·(1 − π/4) wide.
fn thick_paths(role: Role, points: &[Pt], widths: &[f64], island: u32, first: bool, h: f64, s: &Settings) -> Vec<Path> {
    const TOLERANCE: f64 = 0.05;
    let mut out = Vec::new();
    if points.len() < 2 {
        return out;
    }
    let (points, widths) = simplify_thick(points, widths, s.resolution);
    let mut pts: Vec<Pt> = vec![points[0]];
    let mut ws: Vec<f64> = vec![widths[0]];
    for i in 1..points.len() {
        let (a, b, wa, wb) = (points[i - 1], points[i], widths[i - 1], widths[i]);
        let steps = ((wb - wa).abs() / TOLERANCE).ceil() as usize;
        for k in 1..steps {
            let t = k as f64 / steps as f64;
            pts.push(geom::pt(
                (a.x as f64 + (b.x - a.x) as f64 * t).round() as i32,
                (a.y as f64 + (b.y - a.y) as f64 * t).round() as i32,
            ));
            ws.push(wa + (wb - wa) * t);
        }
        pts.push(b);
        ws.push(wb);
    }
    let speed = match role {
        Role::GapFill if first => s.first_layer_infill_speed,
        Role::GapFill => s.gap_infill_speed,
        _ => flow(role, first, h, s).2,
    };
    let emit = |from: usize, to: usize, out: &mut Vec<Path>| {
        let (mut sum, mut length) = (0.0, 0.0);
        for k in from..to {
            let l = geom::dist(pts[k], pts[k + 1]);
            sum += l * (ws[k] + ws[k + 1]) / 2.0;
            length += l;
        }
        if length <= 0.0 {
            return;
        }
        let width = sum / length + h * (1.0 - std::f64::consts::FRAC_PI_4);
        let mm3_per_mm = Settings::mm3_per_mm(width, h);
        out.push(Path {
            role,
            points: pts[from..=to].to_vec(),
            closed: false,
            width,
            mm3_per_mm,
            speed: speed.min(s.speed_cap(mm3_per_mm)),
            accel: accel(role, first, s),
            island,
            object: 0,
        });
    };
    let mut start = 0;
    let (mut lo, mut hi) = (ws[0], ws[0]);
    for i in 1..pts.len() {
        let w = ws[i];
        if (hi - w).abs().max((lo - w).abs()) > TOLERANCE && i - 1 > start {
            emit(start, i - 1, &mut out);
            start = i - 1;
            lo = ws[start];
            hi = ws[start];
        }
        lo = lo.min(w);
        hi = hi.max(w);
    }
    emit(start, pts.len() - 1, &mut out);
    out
}

/// A line of varying width with the points dropped that change neither its course by more than `resolution` mm
/// nor its width by more than 0.02 mm (Ramer–Douglas–Peucker over position and width): the medial axis gives a
/// point every few hundredths of a millimetre, which only makes the file longer.
fn simplify_thick(points: &[Pt], widths: &[f64], resolution: f64) -> (Vec<Pt>, Vec<f64>) {
    let n = points.len();
    if n <= 2 || resolution <= 0.0 {
        return (points.to_vec(), widths.to_vec());
    }
    // Width in units, scaled so its tolerance counts as much as the position's.
    let w_scale = resolution / 0.02 * geom::SCALE;
    let at = |k: usize| [points[k].x as f64, points[k].y as f64, widths[k] * w_scale];
    let tol2 = (resolution * geom::SCALE).powi(2);
    let mut keep = vec![false; n];
    keep[0] = true;
    keep[n - 1] = true;
    let mut stack = vec![(0, n - 1)];
    while let Some((a, b)) = stack.pop() {
        if b <= a + 1 {
            continue;
        }
        let (pa, pb) = (at(a), at(b));
        let d = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]];
        let len2 = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
        let mut best = (a, -1.0);
        for k in a + 1..b {
            let p = at(k);
            let v = [p[0] - pa[0], p[1] - pa[1], p[2] - pa[2]];
            let d2 = if len2 == 0.0 {
                v[0] * v[0] + v[1] * v[1] + v[2] * v[2]
            } else {
                let c = [v[1] * d[2] - v[2] * d[1], v[2] * d[0] - v[0] * d[2], v[0] * d[1] - v[1] * d[0]];
                (c[0] * c[0] + c[1] * c[1] + c[2] * c[2]) / len2
            };
            if d2 > best.1 {
                best = (k, d2);
            }
        }
        if best.1 > tol2 {
            keep[best.0] = true;
            stack.push((a, best.0));
            stack.push((best.0, b));
        }
    }
    let pts = (0..n).filter(|&k| keep[k]).map(|k| points[k]).collect();
    let ws = (0..n).filter(|&k| keep[k]).map(|k| widths[k]).collect();
    (pts, ws)
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
        Role::Bridge | Role::InternalBridge => {
            let internal = role == Role::InternalBridge;
            let (w, mm3, _) = s.bridge_flow(internal, h);
            return (w, mm3, if internal { s.internal_bridge_speed } else { s.bridge_speed });
        }
        Role::GapFill => (s.inner_wall_width, s.gap_infill_speed),
    };
    (w, Settings::mm3_per_mm(w, h), speed)
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
