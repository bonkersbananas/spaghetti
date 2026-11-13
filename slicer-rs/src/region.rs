//! What each layer prints, as regions: per island (a connected part of the slice) its wall loops and the area
//! inside them, then that area split into top and bottom surfaces, bridges, solid shells and sparse infill, from
//! the layers around it. Every pass is per layer and runs in parallel; a pass only reads what earlier passes made.

use crate::config::Settings;
use crate::geom::{self, Contour, Shapes};
use crate::par;
use crate::section::Layers;

/// What an extrusion is, with the names Orca writes in `; FEATURE:` (which the app's 3D view reads).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Role {
    InnerWall,
    OuterWall,
    GapFill,
    Bridge,
    InternalBridge,
    BottomSurface,
    SolidInfill,
    SparseInfill,
    TopSurface,
}

impl Role {
    pub const ALL: [Role; 9] = [
        Role::InnerWall,
        Role::OuterWall,
        Role::GapFill,
        Role::Bridge,
        Role::InternalBridge,
        Role::BottomSurface,
        Role::SolidInfill,
        Role::SparseInfill,
        Role::TopSurface,
    ];

    pub fn feature(self) -> &'static str {
        match self {
            Role::InnerWall => "Inner wall",
            Role::OuterWall => "Outer wall",
            Role::GapFill => "Gap infill",
            Role::Bridge => "Bridge",
            Role::InternalBridge => "Internal Bridge",
            Role::BottomSurface => "Bottom surface",
            Role::SolidInfill => "Internal solid infill",
            Role::SparseInfill => "Sparse infill",
            Role::TopSurface => "Top surface",
        }
    }

    pub fn is_infill(self) -> bool {
        !matches!(self, Role::InnerWall | Role::OuterWall)
    }
}

/// A connected part of a layer: its wall loops and what lies inside them.
#[derive(Clone, Debug, Default)]
pub struct Island {
    /// Loops by depth: `walls[0]` the outer walls (around the outline and every hole), then the inner walls.
    pub walls: Vec<Vec<Contour>>,
    /// Inside the innermost wall: where infill goes.
    pub inner: Shapes,
    /// Between walls, too narrow for another wall or infill: gap fill goes along their middles.
    pub gaps: Shapes,
    /// Which of the plate's objects it is a slice of (an index into them).
    pub object: u32,
}

/// The infill areas of one island, by kind.
#[derive(Clone, Debug, Default)]
pub struct Fills {
    pub top: Shapes,
    pub bottom: Shapes,
    pub bridge: Shapes,
    pub internal_bridge: Shapes,
    pub solid: Shapes,
    pub sparse: Shapes,
}

pub struct LayerRegions {
    pub islands: Vec<Island>,
    pub fills: Vec<Fills>,
}

/// Walls and fills for every layer, from its slice and the object each of the slice's shapes belongs to.
pub fn regions(slices: &[Shapes], owners: &[Vec<u32>], layers: &Layers, s: &Settings) -> Vec<LayerRegions> {
    let n = slices.len();
    // The first layer is pulled in a little against elephant's foot: each shape that leaves lies inside the one it
    // came from, and belongs to its object.
    let islands: Vec<Vec<Island>> = par::map_range(n, |i| {
        let (slice, objects) = if i == 0 && s.elephant_foot > 0.0 {
            let pulled = geom::offset(&slices[0], -s.elephant_foot);
            let objects = pulled.iter().map(|shape| owner_within(shape, &slices[0], &owners[0])).collect();
            (pulled, objects)
        } else {
            (slices[i].clone(), owners[i].clone())
        };
        let mut islands = walls(&slice, i, layers.height[i], s);
        for (island, object) in islands.iter_mut().zip(objects) {
            island.object = object;
        }
        islands
    });

    // Exposed surfaces, from the whole slices (under and over the walls too): what the layer above doesn't cover
    // and what the layer below doesn't hold up, without slivers. Both come from one boolean per pair of layers,
    // and none when the two are the same (a prism's layers). The first layer's whole slice is a bottom.
    let sliver = |i: usize| Settings::spacing(s.solid_infill_width, layers.height[i]) / 4.0;
    let pairs: Vec<(Shapes, Shapes)> = par::map_range(n.saturating_sub(1), |i| {
        if slices[i] == slices[i + 1] {
            return (Vec::new(), Vec::new());
        }
        let (top, bottom) = geom::differences(&slices[i], &slices[i + 1]);
        (geom::opening(&top, sliver(i)), geom::opening(&bottom, sliver(i + 1)))
    });
    let mut tops: Vec<Shapes> = Vec::with_capacity(n);
    let mut bottoms: Vec<Shapes> = Vec::with_capacity(n);
    if n > 0 {
        bottoms.push(slices[0].clone());
    }
    for (top, bottom) in pairs {
        tops.push(top);
        bottoms.push(bottom);
    }
    if n > 0 {
        tops.push(slices[n - 1].clone());
    }
    let exposed: Vec<(Shapes, Shapes)> = tops.into_iter().zip(bottoms).collect();

    let top_layers = s.top_shell_layers.max((s.top_shell_thickness / s.layer_height - 1e-6).ceil() as usize);
    let bottom_layers = s.bottom_shell_layers;
    let fills: Vec<Vec<Fills>> = par::map_range(n, |i| {
        // Solid where a top surface is at most `top_layers` above, or a bottom at most `bottom_layers` below.
        let mut shell: Vec<&Shapes> = Vec::new();
        for (j, (top, _)) in exposed.iter().enumerate().skip(i).take(top_layers) {
            if !top.is_empty() && j >= i {
                shell.push(top);
            }
        }
        for (_, bottom) in exposed.iter().take(i + 1).skip((i + 1).saturating_sub(bottom_layers)) {
            if !bottom.is_empty() {
                shell.push(bottom);
            }
        }
        let shell = if shell.is_empty() { Vec::new() } else { geom::union_all(&shell) };
        let (top, bottom) = &exposed[i];
        islands[i]
            .iter()
            .map(|island| {
                let Some(b) = geom::bbox(&island.inner) else { return Fills::default() };
                let (shell, top, bottom) = (geom::near(&shell, b), geom::near(top, b), geom::near(bottom, b));
                let mut solid = geom::intersection(&island.inner, &shell);
                let mut sparse = geom::difference(&island.inner, &solid);
                // Sparse infill in a small area prints solid (Orca's minimum sparse infill area).
                if sparse.iter().any(|shape| geom::shape_area_mm2(shape) < s.min_sparse_infill_area) {
                    let (small, big): (Shapes, Shapes) =
                        sparse.into_iter().partition(|shape| geom::shape_area_mm2(shape) < s.min_sparse_infill_area);
                    sparse = big;
                    solid = geom::union(&solid, &small);
                }
                let own_top = geom::intersection(&island.inner, &top);
                let own_bottom = geom::intersection(&island.inner, &bottom);
                let solid = geom::difference(&geom::difference(&solid, &own_top), &own_bottom);
                // The first layer's bottom is on the plate; any other bottom is a bridge over air.
                let (bottom, bridge) = if i == 0 { (own_bottom, Vec::new()) } else { (Vec::new(), own_bottom) };
                Fills { top: own_top, bottom, bridge, internal_bridge: Vec::new(), solid, sparse }
            })
            .collect()
    });

    // Solid infill right above sparse infill is printed as an internal bridge.
    let sparse_by_layer: Vec<Shapes> =
        fills.iter().map(|layer| layer.iter().flat_map(|f| f.sparse.iter().cloned()).collect()).collect();
    let fills: Vec<Vec<Fills>> = par::map_range(n, |i| {
        let mut layer = fills[i].clone();
        if i > 0 && !sparse_by_layer[i - 1].is_empty() {
            for f in &mut layer {
                if f.solid.is_empty() {
                    continue;
                }
                let Some(b) = geom::bbox(&f.solid) else { continue };
                let over = geom::intersection(&f.solid, &geom::near(&sparse_by_layer[i - 1], b));
                if !over.is_empty() {
                    f.solid = geom::difference(&f.solid, &over);
                    f.internal_bridge = over;
                }
            }
        }
        layer
    });

    islands.into_iter().zip(fills).map(|(islands, fills)| LayerRegions { islands, fills }).collect()
}

/// The object of the shape in `slice` that holds `shape` (which lies inside one of them).
fn owner_within(shape: &geom::Shape, slice: &Shapes, owners: &[u32]) -> u32 {
    let fallback = owners.first().copied().unwrap_or(0);
    let Some(&p) = shape.first().and_then(|c| c.first()) else { return fallback };
    slice
        .iter()
        .position(|outer| {
            let b = geom::bbox_of(outer);
            p.x >= b[0] && p.x <= b[2] && p.y >= b[1] && p.y <= b[3] && geom::shape_contains(outer, p)
        })
        .and_then(|k| owners.get(k).copied())
        .unwrap_or(fallback)
}

/// How far a wall's or an infill region's outline may stray from the exact offset (mm): offsets round corners with
/// many tiny segments that the printer gains nothing from.
const PATH_RESOLUTION: f64 = 0.0125;

/// Orca's allowance for walls overlapping where a region narrows (`INSET_OVERLAP_TOLERANCE`).
const INSET_OVERLAP_TOLERANCE: f64 = 0.4;

/// How narrow and how wide gap fill's lines may be on a layer (mm), as Orca's.
pub fn gap_widths(layer: usize, height: f64, s: &Settings) -> (f64, f64) {
    let w_inner = if layer == 0 { s.first_layer_width } else { s.inner_wall_width };
    (0.2 * w_inner * (1.0 - INSET_OVERLAP_TOLERANCE), 2.0 * Settings::spacing(w_inner, height))
}

/// mm²: a gap smaller than this gets no gap fill (a 0.05 mm line 0.1 mm long).
const MIN_GAP_AREA: f64 = 0.005;

/// The wall loops of a layer's islands, as Orca's classic walls: the outer one half a line in from the outline,
/// each next one a line's spacing further in, but only where it fits (an opening drops the slivers that would
/// print as a loop going there and back). Where a wall doesn't fit, the narrow leftover is a gap, filled along its
/// middle; the area inside the last wall, less the gaps and parts too narrow for its lines, is for infill. Each
/// step works on the whole layer at once (a boolean costs much the same for one island as for ten), and the
/// results are then shared out to the islands they lie in.
fn walls(slice: &Shapes, layer: usize, height: f64, s: &Settings) -> Vec<Island> {
    let first = layer == 0;
    let (w_outer, w_inner) =
        if first { (s.first_layer_width, s.first_layer_width) } else { (s.outer_wall_width, s.inner_wall_width) };
    let w_solid = if first { s.first_layer_width } else { s.solid_infill_width };
    let sp_outer = Settings::spacing(w_outer, height);
    let sp_inner = Settings::spacing(w_inner, height);
    let min_spacing = sp_inner * (1.0 - INSET_OVERLAP_TOLERANCE);
    let min_infill_spacing = Settings::spacing(w_solid, height) * (1.0 - INSET_OVERLAP_TOLERANCE);
    let (gap_min, gap_max) = gap_widths(layer, height, s);
    // A hair more than nothing: keeps touching edges from counting as gaps (Orca's safety offset).
    let safety = 1.0 / geom::SCALE;

    let mut region = geom::simplify_shapes(&geom::offset(slice, -w_outer / 2.0), PATH_RESOLUTION);
    let mut depths: Vec<Shapes> = Vec::new();
    let mut gaps: Shapes = Vec::new();
    let mut last_spacing = sp_outer;
    if !region.is_empty() {
        depths.push(region.clone());
        // Each inner wall, and one more past the last to find the gaps the last one leaves.
        for k in 1..=s.wall_loops {
            // Orca's precise outer wall: the first inner wall a whole line width from the outer one (no overlap,
            // so the outer wall keeps to the model's outline).
            let d = if k == 1 { (w_outer + w_inner) / 2.0 } else { sp_inner };
            let next = geom::simplify_shapes(
                &geom::offset(&geom::offset(&region, -(d + min_spacing / 2.0)), min_spacing / 2.0),
                PATH_RESOLUTION,
            );
            let gap = geom::difference(&geom::offset(&region, -d / 2.0), &geom::offset(&next, d / 2.0 + safety));
            // Most of what this finds is the crumbs offsets leave in corners: too small to fill.
            gaps.extend(gap.into_iter().filter(|shape| geom::shape_area_mm2(shape) >= MIN_GAP_AREA));
            if k == s.wall_loops || next.is_empty() {
                break;
            }
            region = next;
            depths.push(region.clone());
            last_spacing = sp_inner;
        }
    }
    // Gaps: neither slivers thinner than gap fill's narrowest line nor parts wide enough for anything else,
    // simplified as Orca does before its medial axis (the Voronoi diagram costs by the edge).
    let gaps = if gaps.is_empty() {
        Vec::new()
    } else {
        let wide = geom::offset(&geom::offset(&gaps, -gap_max / 2.0), gap_max / 2.0 + safety);
        geom::simplify_shapes(&geom::difference(&geom::opening(&gaps, gap_min / 2.0), &wide), 0.025)
    };
    // Infill goes inside the last wall, but not where gap fill already goes (as Orca: the gaps come out of the
    // area first), nor in parts too narrow for its lines.
    let inner = if region.is_empty() {
        Vec::new()
    } else {
        let inset = last_spacing / 2.0;
        let room = if gaps.is_empty() { region } else { geom::difference(&region, &gaps) };
        geom::simplify_shapes(
            &geom::offset(&geom::offset(&room, -(inset + min_infill_spacing / 2.0)), min_infill_spacing / 2.0),
            PATH_RESOLUTION,
        )
    };

    // Share everything out to the islands of the slice it lies in.
    let boxes: Vec<[i32; 4]> = slice.iter().map(geom::bbox_of).collect();
    let island_of = |shape: &geom::Shape| -> Option<usize> {
        let p = *shape.first()?.first()?;
        let mut found = None;
        for (i, b) in boxes.iter().enumerate() {
            if p.x >= b[0] && p.x <= b[2] && p.y >= b[1] && p.y <= b[3] {
                if geom::shape_contains(&slice[i], p) {
                    return Some(i);
                }
                found.get_or_insert(i);
            }
        }
        found
    };
    let mut out: Vec<Island> = slice.iter().map(|_| Island::default()).collect();
    for (k, shapes) in depths.iter().enumerate() {
        for shape in shapes {
            if let Some(i) = island_of(shape) {
                let island = &mut out[i];
                while island.walls.len() <= k {
                    island.walls.push(Vec::new());
                }
                island.walls[k].extend(shape.iter().filter(|c| c.len() >= 3).cloned());
            }
        }
    }
    for shape in inner {
        if let Some(i) = island_of(&shape) {
            out[i].inner.push(shape);
        }
    }
    for shape in gaps {
        if let Some(i) = island_of(&shape) {
            out[i].gaps.push(shape);
        }
    }
    out
}
