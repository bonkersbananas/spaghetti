//! Each layer's extrusions in Orca's print order: its islands on a tour that ends next to the plate's origin, each
//! island's walls (around each hole and then the outline, the deepest loop first), then its infill and gap fill
//! chained together as Orca chains them (`order.rs`). Outlines run counter-clockwise and holes clockwise, from the
//! island's rear (a seam that lines up layer to layer), each stopping the seam gap short of where it started. Widths, flows, speeds and accelerations are Orca's for the
//! role; speeds are capped by the filament's volumetric limit. Every path is simplified as Orca simplifies its paths
//! (`geom::simplify_line`, to the profile's resolution, 0.04 mm for sparse infill). Walls and bridges then meet the
//! layer below (`overhang.rs`): a wall's stretches beyond it print as overhang walls, and both slow down where they
//! hang.

use crate::config::Settings;
use crate::fill;
use crate::geom::{self, Contour, Pt, Shapes};
use crate::infill;
use crate::medial;
use crate::monotonic;
use crate::order;
use crate::overhang::Below;
use crate::region::{self, Fills, Island, LayerRegions, Role};
use crate::solid;
use crate::support;

#[derive(Clone, Debug)]
pub struct Path {
    pub role: Role,
    /// A loop repeats its first point at the end.
    pub points: Vec<Pt>,
    pub closed: bool,
    pub width: f64,
    /// mm: how high it is laid down, the layer's height but for thick bridges and supports of their own height
    /// (Orca writes it as `; LAYER_HEIGHT:` where it changes).
    pub height: f64,
    pub mm3_per_mm: f64,
    /// mm/s, before any slowing down for a short layer.
    pub speed: f64,
    pub accel: f64,
    pub island: u32,
    /// Which of the plate's objects it belongs to (an index into them).
    pub object: u32,
    /// How each segment prints, where they don't all print alike: one per segment (empty when they do).
    pub parts: Vec<Part>,
}

/// How one segment of a path prints, over an overhang: a wall's stretch beyond the layer below prints as an overhang
/// wall, and walls and bridges slow down where they hang.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Part {
    pub overhang: bool,
    /// mm/s, before any slowing down for a short layer.
    pub speed: f32,
}

impl Path {
    /// What segment `k` prints as.
    pub fn role_at(&self, k: usize) -> Role {
        if self.parts.get(k).is_some_and(|p| p.overhang) { Role::OverhangWall } else { self.role }
    }

    /// What it starts and what it ends printing as.
    pub fn first_role(&self) -> Role {
        self.role_at(0)
    }

    pub fn last_role(&self) -> Role {
        self.role_at(self.points.len().saturating_sub(2))
    }
}

pub struct LayerPlan {
    /// The G-code layer's index (counting the support's own layers).
    pub index: usize,
    /// Orca's id of the layer, which its fans count by: the object layer's index, else the support layer's.
    pub id: usize,
    pub z: f64,
    /// mm: the object layer's height (the support's own paths carry theirs).
    pub height: f64,
    /// The height the layer's header gives: from the layer below's top, as Orca works it out in single precision.
    pub header_height: f32,
    pub paths: Vec<Path>,
    /// Each object's support areas on the layer: a travel to support that stays inside one needn't retract.
    pub support_islands: Vec<(u32, Shapes)>,
}

/// The kind of each infill region, in the order they print.
const FILL_ORDER: [Role; 6] =
    [Role::Bridge, Role::InternalBridge, Role::BottomSurface, Role::SolidInfill, Role::SparseInfill, Role::TopSurface];

/// Object layer `i`'s extrusions (its top at `z`, `h` high) in print order: the islands that print anything on Orca's
/// tour of their outlines' middles (rounded to the millimetre), which starts next to the wipe tower's position, read
/// as nanometres, so next to the plate's origin, and runs backwards so the layer ends there; an object can come round
/// more than once. `centres` are the middles of the objects' bounding boxes on the plate (units), where their infill
/// patterns are anchored. On the first layer each object's `brims` (`brim.rs`) print just before it. `supports` holds
/// each object's support layer printed with this one, if any: an object with support and no islands here is a stop
/// on the tour at its middle, and its support prints when the tour first comes to it, before its islands, chained as
/// Orca chains it. A layer of the support's own, between the objects' layers, is planned as one with no islands.
#[allow(clippy::too_many_arguments)]
pub fn plan_layer(
    r: &LayerRegions,
    lower: Option<&LayerRegions>,
    i: usize,
    (z, h): (f64, f64),
    centres: &[(f64, f64)],
    brims: &[Vec<Contour>],
    supports: &[Option<&support::Layer>],
    s: &Settings,
) -> LayerPlan {
    // Each object's layer below, where it differs from this one (where it doesn't, nothing hangs).
    let mut below: Vec<Option<Below>> = Vec::new();
    if let Some(lower) = lower
        && i > 0
        && (s.detect_overhang_wall || s.overhang_speed)
    {
        let objects = r.islands.iter().map(|island| island.object as usize + 1).max().unwrap_or(0);
        below = (0..objects as u32)
            .map(|o| {
                let here: Shapes = r.islands.iter().filter(|i| i.object == o).map(|i| i.outline.clone()).collect();
                if here.is_empty() {
                    return None;
                }
                let under = lower.slice_of(o);
                (under != here).then(|| Below::new(&under, s))
            })
            .collect();
    }
    let mut per_island: Vec<Vec<Path>> = r
        .islands
        .iter()
        .zip(&r.fills)
        .enumerate()
        .map(|(k, (island, fills))| {
            let centre = centres.get(island.object as usize).copied().unwrap_or((0.0, 0.0));
            let under = below.get(island.object as usize).and_then(Option::as_ref);
            let trees = r.lightning.get(island.object as usize).map_or(&[][..], Vec::as_slice);
            island_paths(k as u32, island, fills, under, i, (z, h), centre, trees, s)
        })
        .collect();
    // The tour's stops: the islands that print anything, then each object with support and nothing else here.
    let mut nodes: Vec<(Option<usize>, u32)> =
        (0..per_island.len()).filter(|&k| !per_island[k].is_empty()).map(|k| (Some(k), r.islands[k].object)).collect();
    for (o, layer) in supports.iter().enumerate() {
        if layer.is_some_and(|l| !l.items.is_empty()) && !nodes.iter().any(|&(_, object)| object as usize == o) {
            nodes.push((None, o as u32));
        }
    }
    let mm = geom::SCALE as i32;
    let to_mm = |c: i32| (if c >= 0 { c + mm / 2 } else { c - mm / 2 }) / mm * mm;
    let points: Vec<Pt> = nodes
        .iter()
        .map(|&(k, object)| {
            let c = match k {
                Some(k) => r.islands[k].outline.first().map_or(geom::pt(0, 0), |c| geom::centroid(c)),
                None => {
                    let (x, y) = centres.get(object as usize).copied().unwrap_or((0.0, 0.0));
                    geom::pt(x.round() as i32, y.round() as i32)
                }
            };
            geom::pt(to_mm(c.x), to_mm(c.y))
        })
        .collect();
    let mut tour = order::tour(&points, Some(geom::pt(0, 2)));
    tour.reverse();
    let mut paths: Vec<Path> = Vec::new();
    let mut visited = vec![false; supports.len()];
    for t in tour {
        let (k, object) = nodes[t];
        if let Some(Some(layer)) = supports.get(object as usize)
            && !visited[object as usize]
        {
            // Orca reckons the nozzle at the layer's start where the layer before ended, which is planned apart:
            // the plate's origin, where the tour ends, stands in for it.
            let at = paths.last().map_or(geom::pt(0, 0), |p: &Path| p.points[p.points.len() - 1]);
            paths.extend(support_paths(layer, object, at, s));
        }
        if let Some(v) = visited.get_mut(object as usize) {
            *v = true;
        }
        if let Some(k) = k {
            for p in &mut per_island[k] {
                p.object = object;
            }
            paths.append(&mut per_island[k]);
        }
    }
    if i == 0 && brims.iter().any(|b| !b.is_empty()) {
        paths = with_brims(paths, brims, h, s);
    }
    let support_islands =
        supports.iter().enumerate().filter_map(|(o, l)| l.map(|l| (o as u32, l.islands.clone()))).collect();
    LayerPlan { index: i, id: i, z, height: h, header_height: h as f32, paths, support_islands }
}

/// A support layer's extrusions as Orca prints them on an object's first visit (`extrude_support`): chained from
/// `at` (Orca's chaining with improvements), the flange's loop and lines in their own order.
fn support_paths(layer: &support::Layer, object: u32, at: Pt, s: &Settings) -> Vec<Path> {
    let first = layer.first;
    let make = |p: &support::Path| {
        let mm3_per_mm = Settings::mm3_per_mm(p.width, p.height);
        let speed = if first {
            s.first_layer_infill_speed
        } else if p.role == Role::SupportInterface {
            s.support_interface_speed
        } else {
            s.support_speed
        };
        Path {
            role: p.role,
            points: p.points.clone(),
            closed: false,
            width: p.width,
            height: p.height,
            mm3_per_mm,
            speed: speed.min(s.speed_cap(mm3_per_mm)),
            accel: accel(p.role, first, s),
            island: u32::MAX,
            object,
            parts: Vec::new(),
        }
    };
    let ends: Vec<(Pt, Pt)> = layer
        .items
        .iter()
        .map(|item| match item {
            support::Item::Path(p) => (p.points[0], p.points[p.points.len() - 1]),
            support::Item::Fixed(group) => {
                let last = &group[group.len() - 1].points;
                (group[0].points[0], last[last.len() - 1])
            }
        })
        .collect();
    let reversible: Vec<bool> = layer.items.iter().map(|item| matches!(item, support::Item::Path(_))).collect();
    let mut out = Vec::new();
    for (k, reversed) in order::chain(&ends, &reversible, Some(at), true) {
        match &layer.items[k] {
            support::Item::Path(p) => {
                let mut path = make(p);
                if reversed {
                    path.points.reverse();
                }
                out.push(path);
            }
            support::Item::Fixed(group) => out.extend(group.iter().map(make)),
        }
    }
    out
}

/// The first layer's paths with each object's brim loops just before its first path, as Orca prints an object's
/// brim when it first comes to the object. Each loop starts at the point on it nearest where the nozzle is (the
/// plate's origin for the layer's first, where Orca's writer reckons it is) and stops the seam gap short of that
/// point, as Orca's `extrude_loop` splits and clips loops other than walls.
fn with_brims(paths: Vec<Path>, brims: &[Vec<Contour>], h: f64, s: &Settings) -> Vec<Path> {
    let (width, mm3_per_mm, speed) = flow(Role::Brim, true, h, s);
    let speed = speed.min(s.speed_cap(mm3_per_mm));
    let mut out = Vec::with_capacity(paths.len() + brims.iter().map(Vec::len).sum::<usize>());
    let mut done = vec![false; brims.len()];
    let mut at = geom::pt(0, 0);
    for p in paths {
        let o = p.object as usize;
        if o < brims.len() && !done[o] {
            done[o] = true;
            for contour in &brims[o] {
                let Some(points) = brim_loop(contour, at, s.seam_gap) else { continue };
                at = points[points.len() - 1];
                out.push(Path {
                    role: Role::Brim,
                    points,
                    closed: true,
                    width,
                    height: h,
                    mm3_per_mm,
                    speed,
                    accel: accel(Role::Brim, true, s),
                    island: u32::MAX,
                    object: p.object,
                    parts: Vec::new(),
                });
            }
        }
        at = p.points[p.points.len() - 1];
        out.push(p);
    }
    out
}

/// A loop from the point on it nearest `at` (on a segment if need be) round to that point, less `gap` mm at the
/// end (Orca's `ExtrusionLoop::split_at` and `clip_end`); none if the loop is no longer than the gap.
fn brim_loop(contour: &Contour, at: Pt, gap: f64) -> Option<Vec<Pt>> {
    let n = contour.len();
    if n < 2 {
        return None;
    }
    // The first segment whose nearest point is nearest (Orca's `foot_pt`).
    let mut best = (f64::INFINITY, 0usize, contour[0]);
    for k in 0..n {
        let f = foot(at, contour[k], contour[(k + 1) % n]);
        let (dx, dy) = ((f.x - at.x) as f64, (f.y - at.y) as f64);
        let d = dx * dx + dy * dy;
        if d < best.0 {
            best = (d, k, f);
        }
    }
    let (_, k, f) = best;
    let mut points = Vec::with_capacity(n + 2);
    points.push(f);
    for j in 1..=n {
        let q = contour[(k + j) % n];
        if q != points[points.len() - 1] {
            points.push(q);
        }
    }
    if f != points[points.len() - 1] {
        points.push(f);
    }
    clip_end(&mut points, &mut Vec::new(), gap).then_some(points)
}

/// Takes `gap` mm off the end of a loop, and off its segments' parts, so that it stops short of where it started
/// rather than print over it (Orca's `ExtrusionLoop::clip_end`, by its seam gap); false if nothing is left of it.
fn clip_end(points: &mut Vec<Pt>, parts: &mut Vec<Part>, gap: f64) -> bool {
    let mut left = gap * geom::SCALE;
    while left > 0.0 && points.len() >= 2 {
        let n = points.len();
        let (a, b) = (points[n - 2], points[n - 1]);
        let l = geom::dist(a, b);
        if l > left {
            let t = left / l;
            let x = b.x as f64 + (a.x - b.x) as f64 * t;
            let y = b.y as f64 + (a.y - b.y) as f64 * t;
            points[n - 1] = geom::pt(x.round() as i32, y.round() as i32);
            return true;
        }
        left -= l;
        points.pop();
        if !parts.is_empty() {
            parts.pop();
        }
    }
    points.len() >= 2
}

/// The point of segment a–b nearest p (Orca's `Point::projection_onto`).
fn foot(p: Pt, a: Pt, b: Pt) -> Pt {
    if a == b {
        return a;
    }
    let (lx, ly) = ((b.x - a.x) as f64, (b.y - a.y) as f64);
    let theta = ((b.x - p.x) as f64 * lx + (b.y - p.y) as f64 * ly) / (lx * lx + ly * ly);
    if (0.0..=1.0).contains(&theta) {
        let x = theta * a.x as f64 + (1.0 - theta) * b.x as f64;
        let y = theta * a.y as f64 + (1.0 - theta) * b.y as f64;
        return geom::pt(x.round() as i32, y.round() as i32);
    }
    let d2 = |q: Pt| {
        let (dx, dy) = ((q.x - p.x) as f64, (q.y - p.y) as f64);
        dx * dx + dy * dy
    };
    if d2(a) < d2(b) { a } else { b }
}

/// An infill extrusion collection, as Orca makes them: a fill region's lines, or one gap fill path. Fixed ones
/// (monotonic fills, the narrow loops) print as they come; the others may print backwards, and their paths are
/// chained again from where the nozzle is when they start.
struct Group {
    paths: Vec<Path>,
    sortable: bool,
}

#[allow(clippy::too_many_arguments)]
fn island_paths(
    index: u32,
    island: &Island,
    fills: &Fills,
    below: Option<&Below>,
    layer: usize,
    (z, h): (f64, f64),
    centre: (f64, f64),
    trees: &[Vec<Pt>],
    s: &Settings,
) -> Vec<Path> {
    let first = layer == 0;
    let (walls, gaps) = (&island.walls, &island.gaps);
    let island_inner = &island.inner;
    let overlap = island.overlap;
    let mut out: Vec<Path> = Vec::new();
    let island = index;

    // Walls in Orca's order: around each hole and then the outline, the deepest loop first, each level's loops chained
    // from the object's centre.
    let centre_pt = geom::pt(centre.0.round() as i32, centre.1.round() as i32);
    let overhang = overhang_flow(first, h, s);
    for (contour, depth, outline) in wall_order(walls, centre_pt) {
        let role = if depth == 0 { Role::OuterWall } else { Role::InnerWall };
        let wall = path(role, seam_loop(contour, outline), true, island, first, h, s);
        let mut wall = match below {
            Some(below) => below.wall(wall, overhang, s),
            None => wall,
        };
        // It stops the seam gap short of where it started, as Orca's walls do.
        if clip_end(&mut wall.points, &mut wall.parts, s.seam_gap) {
            out.push(wall);
        }
    }

    // Gap fill along the middle of the gaps between walls, as wide as each gap is there: each path on its own.
    let mut groups: Vec<Group> = Vec::new();
    let (gap_min, gap_max) = region::gap_widths(layer, h, s);
    for line in gaps.iter().flat_map(|shape| medial::gap_fill(shape, gap_min, gap_max)) {
        for p in thick_paths(Role::GapFill, &line.points, &line.widths, island, first, h, s) {
            groups.push(Group { paths: vec![p], sortable: true });
        }
    }

    // The infill reaches into the innermost wall, but not into the infill of other kinds beside it.
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
            // A collection for each region, as Orca fills them one by one.
            for shape in region {
                let paths: Vec<Path> = sparse_lines(&vec![shape.clone()], layer, z, h, centre, trees, s)
                    .into_iter()
                    .filter(|points| points.len() >= 2)
                    .map(|points| path(role, points, false, island, first, h, s))
                    .collect();
                if !paths.is_empty() {
                    groups.push(Group { paths, sortable: true });
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
            if bridge { s.bridge_flow(role == Role::InternalBridge, h).spacing } else { Settings::spacing(width, h) };
        let style = solid_style(role, s);
        // Orca keeps a monotonic region's lines in the order its fill makes them.
        let sortable = style == SolidStyle::ZigZag;
        for (part, angle) in parts {
            for shape in &into_walls(&part) {
                if role == Role::SolidInfill
                    && s.narrow_solid_loops
                    && let Some((normal, narrow)) = solid::split_narrow(shape, spacing, angle.to_radians())
                {
                    for n in &normal {
                        let paths = solid_lines(n, role, style, angle, spacing, origin, island, first, h, s);
                        groups.push(Group { paths, sortable });
                    }
                    // Loops fill the narrow part inside the walls (Orca fills it without the overlap), in an order
                    // of their own.
                    let room = geom::intersection(&narrow, &geom::local(island_inner, geom::bbox_of(shape)));
                    let near = geom::pt(origin.0.round() as i32, origin.1.round() as i32);
                    let mut paths = Vec::new();
                    for p in solid::narrow_loops(&room, spacing, s.nozzle_diameter, near) {
                        let (points, widths) = simplify_thick(&p.points, &p.widths, s.resolution);
                        paths.extend(thick_paths(role, &points, &widths, island, first, h, s));
                    }
                    groups.push(Group { paths, sortable: false });
                    continue;
                }
                let mut paths = solid_lines(shape, role, style, angle, spacing, origin, island, first, h, s);
                if bridge && let Some(below) = below {
                    paths = paths.into_iter().map(|p| below.bridge(p, s)).collect();
                }
                groups.push(Group { paths, sortable });
            }
        }
    }

    // The infill and gap fill as Orca's `extrude_infill` prints them: chained from where the walls end, each
    // collection that may be re-sorted chained again from where the nozzle is when it starts.
    groups.retain(|g| !g.paths.is_empty());
    let mut at: Option<Pt> = out.last().and_then(|p| p.points.last().copied());
    let ends: Vec<(Pt, Pt)> =
        groups.iter().map(|g| (g.paths[0].points[0], *g.paths[g.paths.len() - 1].points.last().unwrap())).collect();
    let reversible: Vec<bool> = groups.iter().map(|g| g.sortable).collect();
    let chained = order::chain(&ends, &reversible, at, true);
    let mut groups: Vec<Option<Group>> = groups.into_iter().map(Some).collect();
    for (k, flip) in chained {
        let Some(mut g) = groups[k].take() else { continue };
        if flip {
            g.paths.reverse();
            for p in &mut g.paths {
                p.points.reverse();
            }
        }
        if g.sortable && g.paths.len() > 1 {
            let ends: Vec<(Pt, Pt)> = g.paths.iter().map(|p| (p.points[0], *p.points.last().unwrap())).collect();
            let order = order::chain(&ends, &vec![true; ends.len()], at, true);
            let mut taken: Vec<Option<Path>> = g.paths.into_iter().map(Some).collect();
            g.paths = order
                .into_iter()
                .filter_map(|(i, back)| {
                    let mut p = taken[i].take()?;
                    if back {
                        p.points.reverse();
                    }
                    Some(p)
                })
                .collect();
        }
        at = g.paths.last().and_then(|p| p.points.last().copied());
        out.extend(g.paths);
    }
    out
}

/// The walls' loops in Orca's order (`traverse_loops`): each hole's loops nest in the loop beyond them, the
/// outermost in the innermost loop of the outline that holds it, and each outline loop in the one outside it; a
/// level's loops are chained from `start` (the object's centre), each outline loop printed after what it holds, each
/// hole's loop before. With each loop, its depth (0 the outer wall) and whether it goes round an outline.
fn wall_order(walls: &[Vec<Contour>], start: Pt) -> Vec<(&Contour, usize, bool)> {
    let mut at: Vec<(usize, usize, bool)> = Vec::new();
    let mut contours: Vec<Vec<usize>> = vec![Vec::new(); walls.len()];
    let mut holes: Vec<Vec<usize>> = vec![Vec::new(); walls.len()];
    for (d, level) in walls.iter().enumerate() {
        for (k, c) in level.iter().enumerate() {
            let outline = geom::area2(c) > 0;
            if outline {
                contours[d].push(at.len());
            } else {
                holes[d].push(at.len());
            }
            at.push((d, k, outline));
        }
    }
    let contour = |id: usize| &walls[at[id].0][at[id].1];
    let mut children: Vec<Vec<usize>> = vec![Vec::new(); at.len()];
    let boxes: Vec<[i32; 4]> = (0..at.len())
        .map(|id| {
            contour(id).iter().fold([i32::MAX, i32::MAX, i32::MIN, i32::MIN], |b, p| {
                [b[0].min(p.x), b[1].min(p.y), b[2].max(p.x), b[3].max(p.y)]
            })
        })
        .collect();
    let holds = |parent: usize, child: usize| {
        let (b, p) = (&boxes[parent], contour(child)[0]);
        p.x >= b[0] && p.x <= b[2] && p.y >= b[1] && p.y <= b[3] && geom::contour_contains(contour(parent), p)
    };
    let deepest = walls.len().saturating_sub(1);
    // Holes first: in a hole loop further from the hole, else in the innermost outline loop that holds them.
    for d in 0..walls.len() {
        let mut i = 0;
        while i < holes[d].len() {
            let l = holes[d][i];
            let parent = (d + 1..walls.len())
                .find_map(|t| holes[t].iter().copied().find(|&c| holds(c, l)))
                .or_else(|| (0..=deepest).rev().find_map(|t| contours[t].iter().copied().find(|&c| holds(c, l))));
            match parent {
                Some(p) => {
                    children[p].push(l);
                    holes[d].remove(i);
                }
                None => i += 1,
            }
        }
    }
    // Then each outline loop in the nearest outline loop outside it.
    for d in (1..walls.len()).rev() {
        let mut i = 0;
        while i < contours[d].len() {
            let l = contours[d][i];
            let parent = (0..d).rev().find_map(|t| contours[t].iter().copied().find(|&c| holds(c, l)));
            match parent {
                Some(p) => {
                    children[p].push(l);
                    contours[d].remove(i);
                }
                None => i += 1,
            }
        }
    }
    fn traverse(
        level: &[usize],
        children: &[Vec<usize>],
        first: &dyn Fn(usize) -> Pt,
        outline: &dyn Fn(usize) -> bool,
        start: Pt,
        out: &mut Vec<usize>,
    ) {
        let ends: Vec<(Pt, Pt)> = level.iter().map(|&l| (first(l), first(l))).collect();
        for (k, _) in order::chain(&ends, &vec![true; ends.len()], Some(start), false) {
            let l = level[k];
            if !outline(l) {
                out.push(l);
            }
            traverse(&children[l], children, first, outline, start, out);
            if outline(l) {
                out.push(l);
            }
        }
    }
    let mut order = Vec::with_capacity(at.len());
    let first = |l: usize| contour(l)[0];
    let outline = |l: usize| at[l].2;
    // Loops nested in nothing (Orca drops these; a wall is never dropped here) come after the rest, level by level.
    let mut top: Vec<usize> = contours.first().cloned().unwrap_or_default();
    for level in contours.iter().skip(1).chain(holes.iter()) {
        top.extend(level.iter().copied());
    }
    let (nested, loose): (Vec<usize>, Vec<usize>) = top.into_iter().partition(|&l| at[l].0 == 0 && at[l].2);
    traverse(&nested, &children, &first, &outline, start, &mut order);
    traverse(&loose, &children, &first, &outline, start, &mut order);
    order.into_iter().map(|l| (contour(l), at[l].0, at[l].2)).collect()
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

/// The sparse infill lines of a region on a layer, as printed: Orca's pattern where there is one (lightning's from
/// `trees`, the object's lightning lines on the layer), else straight lines at the infill direction, turned a
/// quarter every other layer.
pub fn sparse_lines(
    region: &Shapes,
    layer: usize,
    z: f64,
    h: f64,
    centre: (f64, f64),
    trees: &[Vec<Pt>],
    s: &Settings,
) -> Vec<Vec<Pt>> {
    if let Some(pattern) = fill::Pattern::of(&s.sparse_infill_pattern) {
        return sparse_runs(region, pattern, layer, (z, h), centre, trees, s);
    }
    let (width, _, _) = flow(Role::SparseInfill, layer == 0, h, s);
    let grown = geom::offset(region, s.infill_wall_overlap * width);
    let angle = if layer.is_multiple_of(2) { s.infill_direction } else { s.infill_direction + 90.0 };
    infill::fill(&grown, angle, Settings::spacing(width, h) / s.sparse_density, 0.0)
}

/// mm Orca's sparse infill area reaches into the walls on a layer `h` high: a share of half the last wall's and half
/// a solid line's spacing.
pub fn sparse_overlap(h: f64, s: &Settings) -> f64 {
    let inset = match s.wall_loops {
        0 => 0.0,
        1 => Settings::spacing(s.outer_wall_width, h) / 2.0,
        _ => Settings::spacing(s.inner_wall_width, h) / 2.0,
    };
    if inset > 0.0 { s.infill_wall_overlap * (inset + Settings::spacing(s.solid_infill_width, h) / 2.0) } else { 0.0 }
}

/// Sparse infill in Orca's pattern (`fill.rs`), where Orca puts its lines' middles: into the walls by Orca's
/// overlap (`sparse_overlap`), less half the infill's spacing.
fn sparse_runs(
    region: &Shapes,
    pattern: fill::Pattern,
    layer: usize,
    (z, h): (f64, f64),
    centre: (f64, f64),
    trees: &[Vec<Pt>],
    s: &Settings,
) -> Vec<Vec<Pt>> {
    let overlap = sparse_overlap(h, s);
    // Orca spaces sparse lines for the object's layer height, so they line up from layer to layer.
    let spacing = Settings::spacing(s.sparse_infill_width, s.layer_height);
    let params = fill::Sparse {
        pattern,
        origin: centre,
        z,
        layer,
        angle: s.infill_direction,
        spacing,
        density: s.sparse_density,
        anchor: s.infill_anchor,
        anchor_max: s.infill_anchor_max,
        trees,
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
            points: geom::simplify_line(&pts[from..=to], resolution(role, s)),
            closed: false,
            width,
            height: h,
            mm3_per_mm,
            speed: speed.min(s.speed_cap(mm3_per_mm)),
            accel: accel(role, first, s),
            island,
            object: 0,
            parts: Vec::new(),
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

/// Width, mm³ per mm and nominal speed of a role on this layer.
pub fn flow(role: Role, first: bool, h: f64, s: &Settings) -> (f64, f64, f64) {
    if first {
        let w = s.first_layer_width;
        if role == Role::Brim {
            return (w, Settings::mm3_per_mm(w, h) * s.brim_flow_ratio, s.first_layer_speed);
        }
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
            let f = s.bridge_flow(internal, h);
            // Orca applies `internal_bridge_flow` to internal bridges as it writes them.
            let mm3 = if internal { f.mm3_per_mm * s.internal_bridge_flow } else { f.mm3_per_mm };
            return (f.width, mm3, if internal { s.internal_bridge_speed } else { s.bridge_speed });
        }
        Role::GapFill => (s.inner_wall_width, s.gap_infill_speed),
        // Only the first layer has one.
        Role::Brim => (s.first_layer_width, s.first_layer_speed),
        Role::Support => (s.support.line_width, s.support_speed),
        Role::SupportInterface => (s.support.line_width, s.support_interface_speed),
        Role::OverhangWall => {
            let f = s.overhang_wall_flow(h);
            return (f.width, f.mm3_per_mm, s.bridge_speed);
        }
    };
    (w, Settings::mm3_per_mm(w, h), speed)
}

/// How high a role's paths are laid on a layer `h` high: a thick bridge (and with thick bridges an overhang wall) is
/// a round thread as high as it is wide, a flat one carrying more plastic (`bridge_flow`) is that much higher, and
/// anything else is the layer's height.
pub fn path_height(role: Role, h: f64, s: &Settings) -> f64 {
    match role {
        Role::Bridge | Role::InternalBridge => s.bridge_flow(role == Role::InternalBridge, h).height,
        Role::OverhangWall => s.overhang_wall_flow(h).height,
        _ => h,
    }
}

/// An overhang wall's width, mm³ per mm, speed and acceleration on a layer `h` high.
pub fn overhang_flow(first: bool, h: f64, s: &Settings) -> (f64, f64, f64, f64) {
    let (width, mm3_per_mm, speed) = flow(Role::OverhangWall, first, h, s);
    (width, mm3_per_mm, speed.min(s.speed_cap(mm3_per_mm)), accel(Role::OverhangWall, first, s))
}

fn accel(role: Role, first: bool, s: &Settings) -> f64 {
    if first {
        return s.first_layer_accel;
    }
    match role {
        Role::OuterWall => s.outer_wall_accel,
        Role::InnerWall => s.inner_wall_accel,
        Role::TopSurface => s.top_surface_accel,
        Role::Bridge | Role::InternalBridge | Role::OverhangWall => s.bridge_accel,
        _ => s.default_accel,
    }
}

/// mm a sparse infill line may stray from its course when simplified (Orca's `SPARSE_INFILL_RESOLUTION`); other
/// paths keep to the profile's resolution.
const SPARSE_INFILL_RESOLUTION: f64 = 0.04;

/// How far a path of a role may stray from its course as Orca simplifies it before printing (mm).
fn resolution(role: Role, s: &Settings) -> f64 {
    if role == Role::SparseInfill { SPARSE_INFILL_RESOLUTION } else { s.resolution }
}

/// A path of a role, simplified as Orca simplifies every path before printing it: without the points it can lose and
/// stay within its resolution of its course (`resolution`), which fills and their anchors along the walls leave by
/// the thousand, a few micrometres apart.
fn path(role: Role, points: Vec<Pt>, closed: bool, island: u32, first: bool, h: f64, s: &Settings) -> Path {
    let (width, mm3_per_mm, speed) = flow(role, first, h, s);
    let speed = speed.min(s.speed_cap(mm3_per_mm));
    Path {
        role,
        points: geom::simplify_line(&points, resolution(role, s)),
        closed,
        width,
        height: path_height(role, h, s),
        mm3_per_mm,
        speed,
        accel: accel(role, first, s),
        island,
        object: 0,
        parts: Vec::new(),
    }
}

/// A wall loop as printed: counter-clockwise, from the rearmost point (largest y, then smallest x), closed.
fn seam_loop(contour: &Contour, outline: bool) -> Vec<Pt> {
    let mut points: Vec<Pt> = contour.clone();
    // Outlines counter-clockwise, holes clockwise (Orca's `wall_direction` ccw).
    if (geom::area2(&points) < 0) == outline {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn square(x0: f64, y0: f64, x1: f64, y1: f64, clockwise: bool) -> Contour {
        let mut c = vec![
            geom::pt(geom::sc(x0), geom::sc(y0)),
            geom::pt(geom::sc(x1), geom::sc(y0)),
            geom::pt(geom::sc(x1), geom::sc(y1)),
            geom::pt(geom::sc(x0), geom::sc(y1)),
        ];
        if clockwise {
            c.reverse();
        }
        c
    }

    #[test]
    fn walls_go_round_each_hole_and_then_the_outline_deepest_first() {
        // Two walls round a 20 mm square with two holes: depth 0 the outer walls, depth 1 the inner ones.
        let walls = vec![
            vec![
                square(0.0, 0.0, 20.0, 20.0, false),
                square(3.0, 3.0, 7.0, 7.0, true),
                square(13.0, 13.0, 17.0, 17.0, true),
            ],
            vec![
                square(0.5, 0.5, 19.5, 19.5, false),
                square(2.5, 2.5, 7.5, 7.5, true),
                square(12.5, 12.5, 17.5, 17.5, true),
            ],
        ];
        let order = wall_order(&walls, geom::pt(0, 0));
        let got: Vec<(usize, bool)> = order.iter().map(|&(_, depth, outline)| (depth, outline)).collect();
        // Each hole's inner wall, then its outer wall, the nearer hole first; then the outline's, inside out.
        assert_eq!(got, vec![(1, false), (0, false), (1, false), (0, false), (1, true), (0, true)]);
        assert_eq!(order[0].0[0], walls[1][1][0], "the hole nearest the start comes first");
        // Outlines run counter-clockwise, holes clockwise.
        for &(contour, _, outline) in &order {
            assert_eq!(geom::area2(&seam_loop(contour, outline)) > 0, outline);
        }
    }

    #[test]
    fn a_loop_stops_the_seam_gap_short_of_where_it_started() {
        // A 10 mm square from its corner round to it again, its last side a slow overhang stretch.
        let mut points = seam_loop(&square(0.0, 0.0, 10.0, 10.0, false), true);
        let start = points[0];
        let slow = Part { overhang: true, speed: 10.0 };
        let mut parts = vec![Part { overhang: false, speed: 200.0 }; 3];
        parts.push(slow);
        assert!(clip_end(&mut points, &mut parts, 0.04));
        assert_eq!((points.len(), parts.len()), (5, 4));
        assert!((geom::dist(points[4], start) / geom::SCALE - 0.04).abs() < 1e-3, "{:?}", points[4]);
        assert_eq!(parts[3], slow);
        // A gap past the last corner takes the last side and its part with it.
        let mut points = seam_loop(&square(0.0, 0.0, 10.0, 10.0, false), true);
        let mut parts = vec![Part { overhang: false, speed: 200.0 }; 4];
        assert!(clip_end(&mut points, &mut parts, 10.5));
        assert_eq!((points.len(), parts.len()), (4, 3));
        // One no longer than the gap is gone.
        let mut points = seam_loop(&square(0.0, 0.0, 0.005, 0.005, false), true);
        assert!(!clip_end(&mut points, &mut Vec::new(), 0.04));
    }
}
