//! What each layer prints, as regions: per island (a connected part of the slice) its wall loops and the area
//! inside them, then that area split into top and bottom surfaces, bridges, solid shells and sparse infill, from
//! the layers around it. Every pass is per layer and runs in parallel; a pass only reads what earlier passes made.

use crate::bridges;
use crate::config::Settings;
use crate::fill;
use crate::geom::{self, Contour, Shapes};
use crate::lightning;
use crate::par;
use crate::plan;
use crate::section::Layers;
use crate::surfaces;

/// What an extrusion is, with the names Orca writes in `; FEATURE:` (which the app's 3D view reads).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Role {
    InnerWall,
    OuterWall,
    /// A wall's stretch beyond the layer below, printed as a bridge (Orca's `erOverhangPerimeter`).
    OverhangWall,
    GapFill,
    Bridge,
    InternalBridge,
    BottomSurface,
    SolidInfill,
    SparseInfill,
    TopSurface,
}

impl Role {
    pub const ALL: [Role; 10] = [
        Role::InnerWall,
        Role::OuterWall,
        Role::OverhangWall,
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
            Role::OverhangWall => "Overhang wall",
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
        !matches!(self, Role::InnerWall | Role::OuterWall | Role::OverhangWall)
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
    /// The shape of the slice it is (on the first layer, pulled in against elephant's foot).
    pub outline: geom::Shape,
    /// mm its infill reaches into its innermost wall: Orca's share (`infill_wall_overlap`; on the first layer and an
    /// object's last, `top_bottom_infill_wall_overlap`) of half the last wall's spacing and half a solid line's.
    pub overlap: f64,
}

/// The infill areas of one island, by kind.
#[derive(Clone, Debug, Default)]
pub struct Fills {
    pub top: Shapes,
    pub bottom: Shapes,
    pub bridge: Shapes,
    /// Each bridge's direction (degrees, the way its lines run), one per shape of `bridge`.
    pub bridge_angles: Vec<f64>,
    pub internal_bridge: Shapes,
    /// Each internal bridge's direction (degrees), one per shape of `internal_bridge`.
    pub internal_bridge_angles: Vec<f64>,
    pub solid: Shapes,
    pub sparse: Shapes,
}

pub struct LayerRegions {
    pub islands: Vec<Island>,
    pub fills: Vec<Fills>,
    /// The layer's top and bottom surfaces (from the whole slice, walls included): a travel to infill that stays
    /// within an island's outline and off these needs no retraction (Orca's test against its internal surfaces, the
    /// slice but its tops and bottoms).
    pub surfaces: Shapes,
    /// The first layer's slice as it was before being pulled in against elephant's foot, each shape with its object:
    /// what the second layer rests on (Orca keeps the first layer's `lslices` so). Empty on every other layer, whose
    /// islands' outlines are its slice.
    pub unpulled: Vec<(geom::Shape, u32)>,
    /// Each object's lightning lines on the layer (`lightning.rs`), when its sparse infill is lightning.
    pub lightning: Vec<Vec<Contour>>,
}

impl LayerRegions {
    /// An object's slice on this layer, as the layer above sees it (Orca's `lslices`).
    pub fn slice_of(&self, object: u32) -> Shapes {
        if self.unpulled.is_empty() {
            self.islands.iter().filter(|i| i.object == object).map(|i| i.outline.clone()).collect()
        } else {
            self.unpulled.iter().filter(|(_, o)| *o == object).map(|(shape, _)| shape.clone()).collect()
        }
    }
}

/// Walls and fills for every layer, from its slice and the object each of the slice's shapes belongs to.
/// `centres` are the middles of the objects' bounding boxes (units), where their sparse infill is anchored.
pub fn regions(
    slices: &[Shapes],
    owners: &[Vec<u32>],
    layers: &Layers,
    centres: &[(f64, f64)],
    s: &Settings,
) -> Vec<LayerRegions> {
    let n = slices.len();
    // Top and bottom surfaces (Orca's `detect_surfaces_type`), from the whole slices (under and over the walls
    // too): what the layer above doesn't cover and what the layer below doesn't hold up, opened by a tenth of the
    // outer wall's width against slivers. Both come from one boolean per pair of layers, and none when the two are
    // the same (a prism's layers). The first layer's whole slice is a bottom, the last one's a top.
    let outer_width = |i: usize| if i == 0 { s.first_layer_width } else { s.outer_wall_width };
    let pairs: Vec<(Shapes, Shapes)> = par::map_range(n.saturating_sub(1), |i| {
        if slices[i] == slices[i + 1] {
            return (Vec::new(), Vec::new());
        }
        let (top, bottom) = geom::differences(&slices[i], &slices[i + 1]);
        (geom::opening(&top, outer_width(i) / 10.0), geom::opening(&bottom, outer_width(i + 1) / 10.0))
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
        // An object's last layer: nothing of it above.
        let last: Vec<bool> = match owners.get(i + 1) {
            Some(above) => objects.iter().map(|o| !above.contains(o)).collect(),
            None => vec![true; objects.len()],
        };
        let around = Around {
            upper: slices.get(i + 1),
            lower: i.checked_sub(1).map(|j| &slices[j]),
            top: &tops[i],
            last: &last,
        };
        let mut islands = walls(&slice, i, layers.height[i], &around, s);
        for ((island, object), shape) in islands.iter_mut().zip(objects).zip(slice) {
            island.object = object;
            island.outline = shape;
        }
        islands
    });

    // Where a surface is both (a part one layer thick), it is a bottom; but a small crack in a top, unless it lies in
    // a larger bottom, is top, with a margin round it.
    let exposed: Vec<(Shapes, Shapes)> =
        par::map_range(n, |i| one_kind(&tops[i], &bottoms[i], i > 0, 1.5 * outer_width(i)));
    drop((tops, bottoms));
    let surfaces: Vec<Shapes> =
        exposed.iter().map(|(top, bottom)| [top.as_slice(), bottom.as_slice()].concat()).collect();

    // Solid shells (Orca's `discover_vertical_shells`, ensuring the shells' thickness everywhere): solid infill
    // under a top surface and over a bottom, as many layers as the shells take, and wherever a layer within that
    // reach has walls or nothing over or under this one's infill area, so that a sloping wall keeps its thickness.
    // Tops and bottoms reach a hair wider than they are (5 % of a solid line), to meet the infill beside them.
    let solid_spacing =
        |i: usize| Settings::spacing(if i == 0 { s.first_layer_width } else { s.solid_infill_width }, layers.height[i]);
    let reaching: Vec<(Shapes, Shapes)> = par::map_range(n, |i| {
        let grow = 0.05 * solid_spacing(i);
        let (top, bottom) = &exposed[i];
        let reach = |shapes: &Shapes| geom::simplify_shapes(&geom::offset(shapes, grow), PATH_RESOLUTION);
        (reach(top), reach(bottom))
    });
    // Each layer's infill area; layers whose slices are alike (a prism's, past the first layer) share a run, and
    // have the same infill area.
    let holes: Vec<Shapes> =
        islands.iter().map(|layer| layer.iter().flat_map(|island| island.inner.iter().cloned()).collect()).collect();
    let mut run = vec![0usize; n];
    for i in 1..n {
        let alike = i > 1 && slices[i] == slices[i - 1] && layers.height[i] == layers.height[i - 1];
        run[i] = if alike { run[i - 1] } else { run[i - 1] + 1 };
    }
    let print_z = |i: usize| layers.top[i];
    let bottom_z = |i: usize| layers.top[i] - layers.height[i];
    let fills: Vec<Vec<Fills>> = par::map_range(n, |i| {
        // The layers the shells reach: tops from above, as many as the top shells take with this one; bottoms from
        // below, likewise.
        let mut shell: Vec<&Shapes> = Vec::new();
        let mut reach: Vec<usize> = Vec::new();
        let mut anchor: Shapes = Vec::new();
        if s.top_shell_layers > 0 {
            let mut j = i + 1;
            while j < n && (j < i + s.top_shell_layers || print_z(j) - print_z(i) < s.top_shell_thickness - 1e-4) {
                reach.push(j);
                shell.push(&reaching[j].0);
                j += 1;
            }
            if j == i + 1 && j < n && !reaching[i].0.is_empty() {
                // One top layer and no shell above it: it still reaches a line into the layer above's slice, so
                // that it rests on something.
                let spacing = Settings::spacing(outer_width(i), layers.height[i]);
                anchor.extend(geom::intersection(&geom::offset(&reaching[i].0, spacing), &slices[j]));
            }
        }
        if s.bottom_shell_layers > 0 {
            let mut j = i;
            while j > 0
                && (j + s.bottom_shell_layers > i + 1
                    || bottom_z(i) - bottom_z(j - 1) < s.bottom_shell_thickness - 1e-4)
            {
                j -= 1;
                reach.push(j);
                shell.push(&reaching[j].1);
            }
            if j == i && i > 0 && !reaching[i].1.is_empty() {
                let spacing = Settings::spacing(outer_width(i), layers.height[i]);
                anchor.extend(geom::intersection(&geom::offset(&reaching[i].1, spacing), &slices[i - 1]));
            }
        }
        shell.retain(|part| !part.is_empty());
        if !anchor.is_empty() {
            shell.push(&anchor);
        }
        reach.retain(|&j| run[j] != run[i]);
        let (top, bottom) = &exposed[i];
        // Solid infill's spacing, with Orca's allowance: what the shells are regularised by.
        let spacing = solid_spacing(i) * 1.05;
        let growth = growth(i, layers.height[i], s);
        islands[i]
            .iter()
            .map(|island| {
                let Some(b) = geom::bbox(&island.inner) else { return Fills::default() };
                let (top, bottom) = (geom::near(top, b), geom::near(bottom, b));
                let own_top = geom::intersection(&island.inner, &top);
                let own_bottom = geom::intersection(&island.inner, &bottom);
                let internal = geom::difference(&geom::difference(&island.inner, &own_top), &own_bottom);
                // Solid under the tops and over the bottoms within reach (only theirs near this island)…
                let near: Vec<Shapes> =
                    shell.iter().map(|part| geom::near(part, b)).filter(|p| !p.is_empty()).collect();
                let shelled = match near.len() {
                    0 => Vec::new(),
                    1 => geom::intersection(&internal, &near[0]),
                    _ => geom::intersection(&internal, &geom::union_all(&near.iter().collect::<Vec<_>>())),
                };
                // …and where a layer within reach has no infill area over or under this one's.
                let mut kept = internal.clone();
                for &j in &reach {
                    let theirs = geom::near(&holes[j], b);
                    kept = if theirs.is_empty() { Vec::new() } else { geom::intersection(&kept, &theirs) };
                    if kept.is_empty() {
                        break;
                    }
                }
                let vertical = if kept == internal { Vec::new() } else { geom::difference(&internal, &kept) };
                let wanted = match (shelled.is_empty(), vertical.is_empty()) {
                    (true, true) => Vec::new(),
                    (false, true) => shelled,
                    (true, false) => vertical,
                    (false, false) => geom::union(&shelled, &vertical),
                };
                // Where the shells take all of the infill area, regularising leaves at most slivers of sparse
                // infill, which turn solid anyway (they are far under the smallest sparse area).
                let all = !wanted.is_empty() && geom::difference(&internal, &wanted).is_empty();
                let (solid, sparse) = if all {
                    (internal, Vec::new())
                } else {
                    let around = (i > 0 && i + 1 < n).then(|| (&slices[i - 1], &slices[i + 1]));
                    let shell = regularise(&wanted, &internal, spacing, around);
                    if shell.is_empty() {
                        (Vec::new(), internal)
                    } else {
                        (geom::intersection(&internal, &shell), geom::difference(&internal, &shell))
                    }
                };
                // The first layer's bottom is on the plate; any other bottom is a bridge over air. Then each grows
                // into the infill beside it, as the tops do.
                let (bottom, bridge) = if i == 0 { (own_bottom, Vec::new()) } else { (Vec::new(), own_bottom) };
                let grown = surfaces::grow_surfaces(own_top, bottom, bridge, solid, sparse, &growth);
                Fills {
                    top: grown.top,
                    bottom: grown.bottom,
                    bridge: grown.bridge,
                    bridge_angles: grown.bridge_angles,
                    internal_bridge: Vec::new(),
                    internal_bridge_angles: Vec::new(),
                    solid: grown.solid,
                    sparse: grown.sparse,
                }
            })
            .collect()
    });

    // Solid infill resting on sparse infill prints as internal bridges, as Orca's do, over the sparse lines as they
    // print. Lightning's trees grow first, round where those bridges will be.
    let candidates = bridges::candidates(&islands, &fills, layers, s);
    let mut lightning = lightning_lines(&islands, &fills, &candidates, layers, centres, s);
    let lines = |layer: usize, island: usize, sparse: &Shapes| {
        let object = islands[layer][island].object as usize;
        let centre = centres.get(object).copied().unwrap_or((0.0, 0.0));
        let trees = lightning.get(object).and_then(|o| o.get(layer)).map_or(&[][..], Vec::as_slice);
        plan::sparse_lines(sparse, layer, layers.top[layer], layers.height[layer], centre, trees, s)
    };
    let fills = bridges::bridge_over_infill(&islands, fills, candidates, layers, &lines, s);

    let mut out: Vec<LayerRegions> = islands
        .into_iter()
        .zip(fills)
        .zip(surfaces)
        .enumerate()
        .map(|(l, ((islands, fills), surfaces))| {
            let lightning =
                lightning.iter_mut().map(|o| o.get_mut(l).map(std::mem::take).unwrap_or_default()).collect();
            LayerRegions { islands, fills, surfaces, unpulled: Vec::new(), lightning }
        })
        .collect();
    if let Some(first) = out.first_mut()
        && s.elephant_foot > 0.0
    {
        first.unpulled = slices[0].iter().cloned().zip(owners[0].iter().copied()).collect();
    }
    out
}

/// Each object's lightning lines, layer by layer (`lightning.rs`), when the sparse infill is lightning. As Orca grows
/// them: from the object's sparse infill area (reaching into the walls by Orca's overlap) before internal bridges
/// take from it, less 3 mm round the solid infill worth bridging over the sparse infill of the layer below, so that
/// the trees hold up those bridges' ends as well.
fn lightning_lines(
    islands: &[Vec<Island>],
    fills: &[Vec<Fills>],
    candidates: &bridges::Candidates,
    layers: &Layers,
    centres: &[(f64, f64)],
    s: &Settings,
) -> Vec<Vec<Vec<Contour>>> {
    if fill::Pattern::of(&s.sparse_infill_pattern) != Some(fill::Pattern::Lightning) || s.sparse_density <= 0.0 {
        return Vec::new();
    }
    let n = fills.len();
    let objects = islands.iter().flatten().map(|island| island.object as usize + 1).max().unwrap_or(0);
    let params = lightning::Params {
        line_width: s.sparse_infill_width,
        density_percent: (s.sparse_density * 100.0 * 1e6).round() / 1e6,
        layer_height: s.layer_height,
        overhang_angle: s.lightning_angles[0],
        prune_angle: s.lightning_angles[1],
        straightening_angle: s.lightning_angles[2],
        junction_gap: Settings::spacing(s.sparse_infill_width, s.layer_height) / 2.0,
    };
    par::map_range(objects, |o| {
        let sparse = |l: usize| -> Shapes {
            islands[l]
                .iter()
                .zip(&fills[l])
                .filter(|(island, _)| island.object as usize == o)
                .flat_map(|(_, f)| f.sparse.iter().cloned())
                .collect()
        };
        let areas: Vec<Shapes> = (0..n)
            .map(|l| {
                let here = sparse(l);
                if here.is_empty() {
                    return here;
                }
                let here = geom::offset(&here, plan::sparse_overlap(layers.height[l], s));
                if l == 0 {
                    return here;
                }
                let worth: Vec<&Shapes> =
                    candidates.on(l).filter(|c| islands[l][c.island].object as usize == o).map(|c| &c.area).collect();
                if worth.is_empty() || sparse(l - 1).is_empty() {
                    return here;
                }
                geom::difference(&here, &geom::offset(&geom::union_all(&worth), 3.0))
            })
            .collect();
        lightning::grow(&areas, centres.get(o).copied().unwrap_or((0.0, 0.0)), &params)
    })
}

/// A layer's top and bottom surfaces with no part in both (Orca's crack rule): a part both is a bottom, unless it
/// is a crack thinner than `margin` in a top, on any layer but the first, that lies in no larger bottom with room
/// to spare; then it stays top and the bottom gives way round it by `margin`.
fn one_kind(top: &Shapes, bottom: &Shapes, cracks_allowed: bool, margin: f64) -> (Shapes, Shapes) {
    if top.is_empty() || bottom.is_empty() {
        return (top.clone(), bottom.clone());
    }
    let cracks = geom::intersection(top, bottom);
    if cracks.is_empty() {
        return (top.clone(), bottom.clone());
    }
    let mut bottom = bottom.clone();
    if cracks_allowed {
        for crack in cracks {
            // A crack wider than twice the margin both ways may be a part, not a crack.
            let cb = geom::bbox_of(&crack);
            let wide = geom::unsc(cb[2] - cb[0]) > 2.0 * margin && geom::unsc(cb[3] - cb[1]) > 2.0 * margin;
            let one = vec![crack];
            if wide && !geom::offset(&one, -margin).is_empty() {
                continue;
            }
            let crack_area = geom::shape_area_mm2(&one[0]);
            let held = bottom.iter().any(|b| {
                let bb = geom::bbox_of(b);
                if !(bb[0] <= cb[0] + 1 && bb[1] <= cb[1] + 1 && bb[2] >= cb[2] - 1 && bb[3] >= cb[3] - 1) {
                    return false;
                }
                let it = vec![b.clone()];
                geom::shape_area_mm2(b) > 2.0 * crack_area
                    && geom::difference(&one, &it).is_empty()
                    && !geom::offset(&geom::difference(&it, &one), -margin).is_empty()
            });
            if held {
                continue;
            }
            // The bottom gives way round the crack: only its shapes near the crack change.
            let grown = geom::offset(&one, margin);
            let Some(gb) = geom::bbox(&grown) else { continue };
            let (near, far): (Shapes, Shapes) = bottom.into_iter().partition(|b| {
                let bb = geom::bbox_of(b);
                bb[0] <= gb[2] && gb[0] <= bb[2] && bb[1] <= gb[3] && gb[1] <= bb[3]
            });
            bottom = far;
            if !near.is_empty() {
                bottom.extend(geom::difference(&near, &grown));
            }
        }
    }
    (geom::difference(top, &bottom), bottom)
}

/// How far a layer's tops, bottoms and bridges grow into the infill beside them (Orca's numbers): into solid
/// infill, the walls' width (half the outer wall's, then the walls' spacings) times √2; into sparse infill, an inner
/// wall's spacing; and gaps closed up to about 0.4 of a solid line.
fn growth(layer: usize, h: f64, s: &Settings) -> surfaces::Growth {
    let first = layer == 0;
    let (w_outer, w_inner) =
        if first { (s.first_layer_width, s.first_layer_width) } else { (s.outer_wall_width, s.inner_wall_width) };
    let w_solid = if first { s.first_layer_width } else { s.solid_infill_width };
    let (shell, least) = if s.wall_loops > 0 {
        let sp_inner = Settings::spacing(w_inner, h);
        (0.5 * w_outer + Settings::spacing(w_outer, h) + sp_inner * (s.wall_loops - 1) as f64, sp_inner)
    } else {
        (1.0 / geom::SCALE, 1.0 / geom::SCALE)
    };
    surfaces::Growth {
        into_solid: shell * std::f64::consts::SQRT_2,
        into_sparse: least,
        closing: 0.55 * 0.65 * 1.05 * Settings::spacing(w_solid, h),
        min_sparse_area: (s.sparse_density > 0.0 && !s.spiral_mode).then_some(s.min_sparse_infill_area),
    }
}

/// Orca's regularisation of the solid shell (`discover_vertical_shells`): slivers thinner than about two thirds of
/// a solid line go, gaps narrower than about a line close, the rest reaches a fifth of a line further; then small
/// pieces go, unless one covers a part of the infill area by itself. `spacing` is solid infill's, with Orca's 5 %;
/// `around` are the slices of the layers below and above, if both are there: a small piece inside both is hidden in
/// the object, and goes even when it is not tiny.
fn regularise(shell: &Shapes, internal: &Shapes, spacing: f64, around: Option<(&Shapes, &Shapes)>) -> Shapes {
    if shell.is_empty() {
        return Vec::new();
    }
    let narrow = 0.5 * 0.65 * spacing;
    let sparse = 0.5 * 1.2 * spacing;
    let overlap = 0.2 * spacing;
    let shell = geom::simplify_shapes(shell, PATH_RESOLUTION);
    let mut out = geom::offset(&geom::offset(&geom::offset(&shell, -narrow), narrow + sparse), -(sparse - overlap));
    // mm²: Orca's thresholds are the spacing times 1.5 mm and 8 mm.
    let (tiny, small) = (spacing * 1.5, spacing * 8.0);
    out.retain(|piece| {
        let area = geom::shape_area_mm2(piece);
        if area >= small {
            return true;
        }
        let one = vec![piece.clone()];
        let pb = geom::bbox_of(piece);
        let hidden = || {
            around.is_some_and(|(below, above)| {
                geom::difference(&one, &geom::local(below, pb)).is_empty()
                    && geom::difference(&one, &geom::local(above, pb)).is_empty()
            })
        };
        if area >= tiny && !hidden() {
            return true;
        }
        // A small piece stays only where it covers a whole part of the infill area.
        let grown = geom::offset(&one, spacing);
        let Some(gb) = geom::bbox(&grown) else { return false };
        internal.iter().any(|part| {
            let pb = geom::bbox_of(part);
            pb[0] >= gb[0]
                && pb[1] >= gb[1]
                && pb[2] <= gb[2]
                && pb[3] <= gb[3]
                && geom::difference(&vec![part.clone()], &grown).is_empty()
        })
    });
    out
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

/// What `split_top` finds: the top infill beside the outer wall alone (before it reaches into the wall), and the rest
/// of the area inside the outer wall, where the inner walls go.
struct TopSplit {
    fill: Shapes,
    rest: Shapes,
}

/// Orca's `split_top_surfaces`, for one wall round a top surface, island by island: of the area inside the outer wall
/// (`region`), what neither the layer above, grown by `min_width_top_surface`, nor a bridge over the layer below
/// (grown by one and a half walls, a millimetre and half a spacing) covers is a top. Grown back by nine tenths of the
/// outer wall's width and that same width, less half its spacing, the top takes the inner walls' place; its fill
/// keeps a spacing from the outer wall's middle, reaches half that spacing beyond the top, and stays just inside the
/// outer wall; the inner walls go round the rest. None where nothing is a top. A top lies within the layer's tops,
/// so everything that decides it is worked out in their box only, and the island's outline is cut to it (exact
/// inside the box: what the box cuts off is farther than any offset reaches).
fn split_top(region: &Shapes, around: &Around, layer: usize, height: f64, s: &Settings) -> Option<TopSplit> {
    let upper = around.upper?;
    if around.top.is_empty() {
        return None;
    }
    let first = layer == 0;
    let (w_outer, w_inner) =
        if first { (s.first_layer_width, s.first_layer_width) } else { (s.outer_wall_width, s.inner_wall_width) };
    let (sp_outer, sp_inner) = (Settings::spacing(w_outer, height), Settings::spacing(w_inner, height));
    let min_width = (sp_outer / 2.0 + 1e-5).max(s.min_width_top_surface.of(w_inner));
    // Orca's `offset_top_surface`: the walls' width less the inner walls', nine tenths of it.
    let reach = 0.9 * w_outer + min_width - sp_outer / 2.0;
    let bridge_reach = 1.5 * sp_outer.max(w_inner) + 1.0f64.min(s.nozzle_diameter / 0.4) + sp_inner / 2.0;
    let within = |a: [i32; 4], b: [i32; 4]| [a[0].max(b[0]), a[1].max(b[1]), a[2].min(b[2]), a[3].min(b[3])];
    let mut out = TopSplit { fill: Vec::new(), rest: Vec::new() };
    let mut any = false;
    for shape in region {
        // Islands no top reaches keep their walls, and so do those whose tops are thin strips (a slope's): a top
        // lies half the outer wall in from the outline and `min_width` from the layer above, so the tops hold a
        // disc that wide round it.
        let b = geom::inflate(geom::bbox_of(shape), 1e-4);
        let tops = geom::near(around.top, b);
        // (Simplified first, to 0.05 mm, as the strips have many points; the disc is taken that much smaller.)
        let thick = if tops.is_empty() {
            tops
        } else {
            geom::offset(&geom::simplify_shapes(&tops, 0.05), -(w_outer / 2.0).min(min_width) + 0.06)
        };
        // The top lies in that disc's middle: in the thick part of the tops.
        let Some(tb) = geom::bbox(&thick) else {
            out.rest.push(shape.clone());
            continue;
        };
        let orig: Shapes = vec![shape.clone()];
        // A mitred corner where the box cuts an outline reaches up to about three and a half times an offset's
        // distance: the box keeps that far from the tops.
        let local = |shapes: &Shapes, d: f64| geom::clip_box(shapes, within(b, geom::inflate(tb, 3.5 * d + 0.01)));
        // What a bridge over the layer below takes, and the layer above with its margin (Orca clips both to the
        // island's box).
        let mut held = local(&orig, 0.0);
        if let Some(lower) = around.lower {
            let unsupported = geom::difference(&local(&orig, bridge_reach), &local(lower, bridge_reach));
            if !unsupported.is_empty() {
                held = geom::difference(&held, &geom::offset(&unsupported, bridge_reach));
            }
        }
        let top = geom::difference(&held, &geom::offset(&local(upper, min_width), min_width));
        if top.is_empty() {
            out.rest.push(shape.clone());
            continue;
        }
        any = true;
        let grown = geom::offset(&top, reach);
        let gb = geom::bbox(&grown).unwrap_or(tb);
        // The outline offset by `d`, exact as far as `beyond` past the grown top.
        let near_grown = |d: f64, beyond: f64| {
            geom::offset(&geom::clip_box(&orig, geom::inflate(gb, beyond + 3.5 * d.abs() + 0.01)), d)
        };
        // A spacing in from the outer wall's middle: the top's fill goes inside, and what of the top is outside
        // stays with the rest (for gap fill beside the wall).
        let fill_clip = near_grown(-sp_outer, 0.0);
        let beside_wall = geom::difference(&top, &fill_clip);
        let tops_fill = geom::intersection(&fill_clip, &grown);
        // Its fill reaches half the outer wall's spacing beyond, as far as half a sparse line inside the wall.
        let clip = near_grown(sp_outer / 2.0 - s.sparse_infill_width / 2.0, sp_outer / 2.0);
        out.fill.extend(geom::intersection(&clip, &geom::offset(&tops_fill, sp_outer / 2.0)));
        let walled = geom::difference(&orig, &grown);
        out.rest.extend(if s.gap_infill_speed > 0.0 { geom::union(&walled, &beside_wall) } else { walled });
    }
    any.then_some(out)
}

/// How narrow and how wide gap fill's lines may be on a layer (mm), as Orca's: a fifth of the narrower wall's
/// width less the overlap allowance, and two inner walls' spacing.
pub fn gap_widths(layer: usize, height: f64, s: &Settings) -> (f64, f64) {
    let (w_outer, w_inner) =
        if layer == 0 { (s.first_layer_width, s.first_layer_width) } else { (s.outer_wall_width, s.inner_wall_width) };
    (0.2 * w_outer.min(w_inner) * (1.0 - INSET_OVERLAP_TOLERANCE), 2.0 * Settings::spacing(w_inner, height))
}

/// mm²: a gap smaller than this gets no gap fill (a 0.05 mm line 0.1 mm long).
const MIN_GAP_AREA: f64 = 0.005;

/// The wall loops of a layer's islands, as Orca's classic walls: the outer one half a line in from the outline,
/// each next one a line's spacing further in, but only where it fits (an opening drops the slivers that would
/// print as a loop going there and back). Where a wall doesn't fit, the narrow leftover is a gap, filled along its
/// middle; the area inside the last wall, less the gaps and parts too narrow for its lines, is for infill. Each
/// step works on the whole layer at once (a boolean costs much the same for one island as for ten), and the
/// results are then shared out to the islands they lie in. With Orca's `only_one_wall_top`, an object's last layer
/// gets one wall, and a top surface only the outer wall, its top infill reaching right up to it (`split_top`).
fn walls(slice: &Shapes, layer: usize, height: f64, around: &Around, s: &Settings) -> Vec<Island> {
    if !around.last.iter().any(|&l| l) {
        return wall_group(slice, s.wall_loops, false, layer, height, around, s);
    }
    // An object's last layer: one wall with `only_one_wall_top`, and its infill's overlap is the top's.
    let (last, rest): (Vec<usize>, Vec<usize>) = (0..slice.len()).partition(|&k| around.last[k]);
    let pick = |ks: &[usize]| -> Shapes { ks.iter().map(|&k| slice[k].clone()).collect() };
    let mut out: Vec<Island> = slice.iter().map(|_| Island::default()).collect();
    for (ks, is_last) in [(last, true), (rest, false)] {
        if ks.is_empty() {
            continue;
        }
        let one_wall = is_last && s.only_one_wall_top && s.top_shell_layers > 0;
        let loops = if one_wall { s.wall_loops.min(1) } else { s.wall_loops };
        let islands = wall_group(&pick(&ks), loops, is_last, layer, height, around, s);
        for (k, island) in ks.into_iter().zip(islands) {
            out[k] = island;
        }
    }
    out
}

/// The layers around one, as the walls see them: the slices above and below (none above the plate's last layer, none
/// below the first), this layer's tops and, for each shape of the slice, whether it is on its object's last layer.
pub struct Around<'a> {
    pub upper: Option<&'a Shapes>,
    pub lower: Option<&'a Shapes>,
    /// What the layer above doesn't cover (the tops `regions` finds): where a top may be split off.
    pub top: &'a Shapes,
    pub last: &'a [bool],
}

/// `walls` for shapes that all get `loops` walls, and are (`last`) or aren't on their objects' last layer.
fn wall_group(
    slice: &Shapes,
    loops: usize,
    last: bool,
    layer: usize,
    height: f64,
    around: &Around,
    s: &Settings,
) -> Vec<Island> {
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
    // Top infill beside the outer wall alone (`split_top`).
    let mut top: Option<Shapes> = None;
    if !region.is_empty() {
        depths.push(region.clone());
        if loops > 1
            && !last
            && s.only_one_wall_top
            && s.top_shell_layers > 0
            && let Some(split) = split_top(&region, around, layer, height, s)
        {
            region = split.rest;
            top = Some(split.fill);
        }
        // Each inner wall, and one more past the last to find the gaps the last one leaves.
        for k in 1..=loops {
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
            if k == loops || next.is_empty() {
                break;
            }
            region = next;
            depths.push(region.clone());
            last_spacing = sp_inner;
        }
    }
    // Gaps: neither slivers thinner than gap fill's narrowest line nor parts wide enough for anything else,
    // simplified as Orca simplifies them before its medial axis: to a fifth of the resolution, as Orca does when it
    // fits arcs (the profile's default).
    let gaps = if gaps.is_empty() {
        Vec::new()
    } else {
        let wide = geom::offset(&geom::offset(&gaps, -gap_max / 2.0), gap_max / 2.0 + safety);
        geom::simplify_shapes(&geom::difference(&geom::opening(&gaps, gap_min / 2.0), &wide), 0.2 * s.resolution)
    };
    // Infill goes inside the last wall, but not where gap fill already goes (as Orca: the gaps come out of the
    // area first), nor in parts too narrow for its lines.
    let mut inner = if region.is_empty() {
        Vec::new()
    } else {
        let inset = last_spacing / 2.0;
        let room = if gaps.is_empty() { region } else { geom::difference(&region, &gaps) };
        geom::simplify_shapes(
            &geom::offset(&geom::offset(&room, -(inset + min_infill_spacing / 2.0)), min_infill_spacing / 2.0),
            PATH_RESOLUTION,
        )
    };
    // How far the infill reaches into the walls, which the planner adds (Orca's overlap, `Island::overlap`).
    let sp_solid = Settings::spacing(w_solid, height);
    let share = if first || last { s.top_bottom_infill_wall_overlap } else { s.infill_wall_overlap };
    let inset = match loops {
        0 => 0.0,
        1 => sp_outer / 2.0,
        _ => sp_inner / 2.0,
    };
    let overlap = if loops == 0 { 0.0 } else { share * (inset + sp_solid / 2.0) };
    // A top beside the outer wall alone: Orca's top fill, reaching into the wall by `top_bottom_infill_wall_overlap`
    // (nothing on the first layer) rather than the infill's overlap.
    if let Some(fill) = top {
        let top_overlap = if first { 0.0 } else { s.top_bottom_infill_wall_overlap * (inset + sp_solid / 2.0) };
        let fill = if (top_overlap - overlap).abs() > 1e-6 { geom::offset(&fill, top_overlap - overlap) } else { fill };
        inner = geom::simplify_shapes(&geom::union(&inner, &fill), PATH_RESOLUTION);
    }

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
    let mut out: Vec<Island> = slice.iter().map(|_| Island { overlap, ..Island::default() }).collect();
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geom::sc;

    fn square(x0: f64, y0: f64, x1: f64, y1: f64) -> geom::Shape {
        vec![vec![
            geom::pt(sc(x0), sc(y0)),
            geom::pt(sc(x1), sc(y0)),
            geom::pt(sc(x1), sc(y1)),
            geom::pt(sc(x0), sc(y1)),
        ]]
    }

    #[test]
    fn a_top_surface_has_only_the_outer_wall_and_its_infill_reaches_it() {
        // A 20 mm block 2 mm high with a 6 mm one standing in its middle, sliced with the X2D's defaults
        // (`only_one_wall_top`).
        let s = Settings::default();
        let layers = Layers::plan(4.0, 0.2, 0.2);
        let n = layers.top.len();
        let slices: Vec<Shapes> = (0..n)
            .map(|i| {
                if layers.top[i] < 2.0 + 1e-6 {
                    vec![square(0.0, 0.0, 20.0, 20.0)]
                } else {
                    vec![square(7.0, 7.0, 13.0, 13.0)]
                }
            })
            .collect();
        let owners: Vec<Vec<u32>> = slices.iter().map(|slice| vec![0; slice.len()]).collect();
        let regions = regions(&slices, &owners, &layers, &[(sc(10.0) as f64, sc(10.0) as f64)], &s);
        let length = |loops: &[Contour]| loops.iter().map(|c| geom::length_mm(c, true)).sum::<f64>();
        let step = layers.top.iter().position(|&z| z > 2.0 + 1e-6).unwrap() - 1;

        // The big block's top: the outer wall round it all, the inner wall only round what the small block
        // stands on, and the top's infill right up to the outer wall (0.6 mm in is under the inner wall elsewhere).
        let top = &regions[step].islands[0];
        assert!(length(&top.walls[0]) > 75.0, "{}", length(&top.walls[0]));
        assert!(length(&top.walls[1]) < 45.0, "{}", length(&top.walls[1]));
        assert!(geom::contains(&top.inner, geom::pt(sc(0.6), sc(10.0))));
        // Below it, both walls go all the way round.
        let below = &regions[step - 6].islands[0];
        assert!(length(&below.walls[1]) > 70.0, "{}", length(&below.walls[1]));
        assert!(!geom::contains(&below.inner, geom::pt(sc(0.6), sc(10.0))));
        // The small block's last layer has one wall.
        assert_eq!(regions[n - 1].islands[0].walls.len(), 1);
    }
}
