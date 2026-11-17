//! Ironing, as Orca's `Layer::make_ironing` (`Fill.cpp`) makes it: after an island's infill, the nozzle runs again
//! over its top surfaces in lines a fraction of a millimetre apart, extruding a trickle (a tenth of a layer's flow by
//! default), which smooths the top's ridges.
//!
//! What is ironed, by `ironing_type`: every top surface (`top`), only the object's last layer's (`topmost`), or every
//! solid surface (`solid`: tops, bottoms on the plate and solid infill, or the whole slice where the layer has no
//! sparse infill or internal bridge). Tops count only with top shells (`top_shell_layers`), as Orca's do. The area is
//! cut back from the slice's edge by `ironing_inset` (half the nozzle where that is 0), and each of its shapes is
//! filled with Orca's monotonic lines (`monotonic.rs`) at `ironing_spacing`, on the object's grid, not spread out,
//! joined along the edge up to three spacings, in the top surface's direction turned by `ironing_angle`.

use crate::config::{IronWhere, Settings};
use crate::geom::{self, Shapes};
use crate::region::{Fills, Island};

/// Fills in each island's `ironing`: `exposed` holds each layer's top and bottom surfaces of the whole slice (Orca's
/// `stTop` and `stBottom` slices), `first` the first layer's slice before it was pulled in against elephant's foot,
/// which Orca's ironing cuts back from there.
pub fn areas(
    islands: &[Vec<Island>],
    fills: &mut [Vec<Fills>],
    exposed: &[(Shapes, Shapes)],
    first: Option<&Shapes>,
    s: &Settings,
) {
    let iron = &s.iron;
    // Tops are ironed only with top shells (or, in spiral vase mode, more than one bottom one), as Orca gates them.
    let gated = s.top_shell_layers > 0 || (s.spiral_mode && s.bottom_shell_layers > 1);
    if iron.surfaces != IronWhere::Solid && !gated {
        return;
    }
    let tops_count = s.top_shell_layers > 0 || s.spiral_mode;
    // Each object's last layer (all of its regions: Orca's `upper_layer` is the object's).
    let groups = islands.iter().flatten().map(|i| i.group as usize + 1).max().unwrap_or(0);
    let mut last = vec![0usize; groups];
    for (l, layer) in islands.iter().enumerate() {
        for island in layer {
            last[island.group as usize] = l;
        }
    }
    let inset = if iron.inset == 0.0 { 0.5 * s.nozzle_diameter } else { iron.inset };
    let held = s.bottoms_held();
    let done: Vec<Vec<Shapes>> = crate::par::map_range(islands.len(), |l| {
        let (top, bottom) = &exposed[l];
        // Whether the layer's regions are solid throughout (no sparse infill, unless nearly solid, and no internal
        // bridge): `solid` then irons each of their whole slices.
        let solid_throughout = |object: u32| {
            islands[l]
                .iter()
                .zip(&fills[l])
                .filter(|(i, _)| i.object == object)
                .all(|(_, f)| (s.sparse_density > 0.95 || f.sparse.is_empty()) && f.internal_bridge.is_empty())
        };
        islands[l]
            .iter()
            .zip(&fills[l])
            .map(|(island, f)| {
                let ironed = match iron.surfaces {
                    IronWhere::Nowhere => false,
                    IronWhere::Tops | IronWhere::Solid => true,
                    IronWhere::Topmost => last[island.group as usize] == l,
                };
                if !ironed || island.outline.is_empty() {
                    return Vec::new();
                }
                let b = geom::bbox_of(&island.outline);
                // The island's slice as the layer above sees it: on the first layer, as sliced.
                let slice: Shapes = match first {
                    Some(first) if l == 0 => geom::near(first, b)
                        .into_iter()
                        .filter(|shape| {
                            !geom::intersection(&vec![shape.clone()], &vec![island.outline.clone()]).is_empty()
                        })
                        .collect(),
                    _ => vec![island.outline.clone()],
                };
                let mut polys: Shapes = Vec::new();
                if iron.surfaces == IronWhere::Solid && solid_throughout(island.object) {
                    polys = slice.clone();
                } else {
                    if tops_count {
                        polys.extend(geom::near(top, b));
                    }
                    if iron.surfaces == IronWhere::Solid {
                        if (l == 0 || held) && s.bottom_shell_layers > 0 {
                            polys.extend(geom::near(bottom, b));
                        }
                        // Solid infill, as far as it reaches into the walls (not into the infill beside it).
                        if island.overlap > 0.0 && !f.solid.is_empty() {
                            let others = geom::difference(&island.inner, &f.solid);
                            polys.extend(geom::difference(&geom::offset(&f.solid, island.overlap), &others));
                        } else {
                            polys.extend(f.solid.iter().cloned());
                        }
                        polys = geom::union_all(&[&polys]);
                    }
                }
                if polys.is_empty() {
                    return Vec::new();
                }
                geom::intersection(&polys, &geom::offset(&slice, -inset))
            })
            .collect()
    });
    for (layer, areas) in fills.iter_mut().zip(done) {
        for (f, area) in layer.iter_mut().zip(areas) {
            f.ironing = area;
        }
    }
}
