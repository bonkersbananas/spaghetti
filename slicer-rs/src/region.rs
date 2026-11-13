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
    Bridge,
    InternalBridge,
    BottomSurface,
    SolidInfill,
    SparseInfill,
    TopSurface,
}

impl Role {
    pub const ALL: [Role; 8] = [
        Role::InnerWall,
        Role::OuterWall,
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

/// Walls and fills for every layer.
pub fn regions(slices: &[Shapes], layers: &Layers, s: &Settings) -> Vec<LayerRegions> {
    let n = slices.len();
    // The first layer is pulled in a little against elephant's foot.
    let islands: Vec<Vec<Island>> = par::map_range(n, |i| {
        let slice = if i == 0 && s.elephant_foot > 0.0 {
            geom::offset(&slices[0], -s.elephant_foot)
        } else {
            slices[i].clone()
        };
        walls(&slice, i, layers.height[i], s)
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

/// How far a wall's or an infill region's outline may stray from the exact offset (mm): offsets round corners with
/// many tiny segments that the printer gains nothing from.
const PATH_RESOLUTION: f64 = 0.0125;

/// The wall loops of a layer's islands (Orca's classic walls: the outer one half a line in from the outline, each
/// next one a line's spacing further in) and the area inside them.
fn walls(slice: &Shapes, layer: usize, height: f64, s: &Settings) -> Vec<Island> {
    let first = layer == 0;
    let (w_outer, w_inner) =
        if first { (s.first_layer_width, s.first_layer_width) } else { (s.outer_wall_width, s.inner_wall_width) };
    let sp_outer = Settings::spacing(w_outer, height);
    let sp_inner = Settings::spacing(w_inner, height);
    let mut out = Vec::with_capacity(slice.len());
    for shape in slice {
        let island_shapes: Shapes = vec![shape.clone()];
        let mut region = geom::simplify_shapes(&geom::offset(&island_shapes, -w_outer / 2.0), PATH_RESOLUTION);
        let mut walls = Vec::new();
        let mut last_spacing = sp_outer;
        if !region.is_empty() {
            walls.push(contours(&region));
            for k in 1..s.wall_loops {
                let d = if k == 1 { (sp_outer + sp_inner) / 2.0 } else { sp_inner };
                let next = geom::simplify_shapes(&geom::offset(&region, -d), PATH_RESOLUTION);
                if next.is_empty() {
                    break;
                }
                region = next;
                walls.push(contours(&region));
                last_spacing = sp_inner;
            }
        }
        let inner = if region.is_empty() {
            Vec::new()
        } else {
            geom::simplify_shapes(&geom::offset(&region, -last_spacing / 2.0), PATH_RESOLUTION)
        };
        out.push(Island { walls, inner });
    }
    out
}

fn contours(shapes: &Shapes) -> Vec<Contour> {
    shapes.iter().flat_map(|shape| shape.iter().cloned()).filter(|c| c.len() >= 3).collect()
}
