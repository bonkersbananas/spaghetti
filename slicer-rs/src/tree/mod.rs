//! Orca's organic tree supports ("tree(auto)" in its default style, `smsTreeOrganic`), ported from OrcaSlicer 2.5's
//! `TreeSupport3D.cpp`: PrusaSlicer's port of CuraEngine's tree supports, with Orca's own overhang detection
//! (`TreeSupport::detect_overhangs`). In its steps:
//!
//! 1. Overhangs (`overhangs.rs`): where a layer reaches more than the support angle beyond the one below, small
//!    clusters of them dropped, and islands that start in the air ("sharp tails").
//! 2. The model's volumes (`volumes.rs`): for each branch radius and layer, where a branch would collide with the
//!    model, and where it can go so that it still reaches the plate or the model below ("avoidance").
//! 3. Growth: tips sampled on the overhangs, then layer by layer down, each branch's area moved and widened within
//!    the avoidance, branches that meet merged, until they rest on the plate or the model.
//! 4. Drawing: the branches smoothed and turned into round meshes, sliced into the support's layers, with roofs and
//!    floors of interface, then printed as Orca prints support.
//!
//! Lengths are kept in Orca's nanometres where Orca keeps integers, so that its truncations come out the same; the
//! polygon work is in `geom`'s units (0.1 µm).

pub mod draw;
pub mod grow;
pub mod overhangs;
pub mod seed;
pub mod smooth;
pub mod util;
pub mod volumes;

use crate::config::Settings;
use crate::geom::Shapes;

/// mm from Orca's nanometres.
#[inline]
pub fn mm(nm: f64) -> f64 {
    nm / 1e6
}

/// Orca's `scaled<coord_t>`: mm to nanometres, truncated.
#[inline]
fn scaled(mm: f64) -> i64 {
    (mm / 1e-6) as i64
}

/// What the trees are made with: Orca's `TreeSupportSettings` and its `TreeSupportMeshGroupSettings`, worked out as
/// Orca works them out (nanometres unless said otherwise).
#[derive(Clone, Debug)]
pub struct Config {
    pub layer_height: i64,
    /// mm: the first layer's height and the layers' (the support's layer `i` is the object's).
    pub first_layer_height_mm: f64,
    pub layer_height_mm: f64,
    pub resolution: i64,
    /// `min_feature_size` as the trees read it (its number as mm), which widens a branch's safe moves.
    pub min_feature_size: i64,
    /// Radians from horizontal: an overhang flatter than this needs support (the threshold plus one degree).
    pub support_angle: f64,
    /// Degrees: the overhang threshold Orca's detection uses (the setting plus one).
    pub threshold_degrees: f64,
    pub support_line_width: i64,
    pub support_roof_line_width: i64,
    pub support_bottom_enable: bool,
    pub support_bottom_height: i64,
    pub support_xy_distance: i64,
    pub support_xy_distance_overhang: i64,
    pub support_top_distance: i64,
    pub support_bottom_distance: i64,
    pub support_roof_layers: usize,
    pub support_floor_layers: usize,
    pub support_line_spacing: i64,
    pub support_wall_count: i64,
    pub support_roof_line_distance: i64,
    pub branch_distance: i64,
    pub tree_angle: f64,
    pub tree_angle_slow: f64,
    pub branch_diameter: i64,
    pub branch_diameter_angle: f64,
    /// Percent.
    pub top_rate: f64,
    pub tip_diameter: i64,
    pub remove_small_overhangs: bool,
    // `TreeSupportSettings`.
    pub branch_radius: i64,
    pub min_radius: i64,
    pub maximum_move_distance: i64,
    pub maximum_move_distance_slow: i64,
    pub support_bottom_layers: usize,
    pub tip_layers: usize,
    pub branch_radius_increase_per_layer: f64,
    pub max_to_model_radius_increase: i64,
    pub min_dtt_to_model: usize,
    pub increase_radius_until_radius: i64,
    pub increase_radius_until_layer: usize,
    pub support_rests_on_model: bool,
    pub xy_distance: i64,
    pub xy_min_distance: i64,
    pub bp_radius: i64,
    pub bp_radius_increase_per_layer: f64,
    pub z_distance_bottom_layers: usize,
    pub z_distance_top_layers: usize,
    pub layer_start_bp_radius: i64,
}

impl Config {
    pub fn new(s: &Settings) -> Config {
        let sp = &s.support;
        let layer_height = scaled(s.layer_height);
        // Widths are Orca's float flows, scaled and truncated.
        let width = |w: f64| scaled(w as f32 as f64);
        let support_line_width = width(sp.line_width);
        let bottom_layers = sp.bottom_interface_layers;
        let support_bottom_enable = bottom_layers > 0;
        let support_xy_distance = scaled(sp.xy_distance);
        let support_xy_distance_overhang = support_xy_distance.min(scaled(0.5 * (s.outer_wall_width as f32 as f64)));
        let clamp = |degrees: f64, max: f64| (degrees * std::f64::consts::PI / 180.0).clamp(0.0, max);
        let half_pi = 0.5 * std::f64::consts::PI;
        let tree_angle = clamp(sp.tree_branch_angle, half_pi - 1e-4);
        let tree_angle_slow = clamp(sp.tree_angle_slow, tree_angle - 1e-4);
        let branch_diameter = scaled(sp.tree_branch_diameter);
        let tip_diameter = scaled(sp.tree_tip_diameter).clamp(0, branch_diameter);
        let branch_radius = branch_diameter / 2;
        let min_radius = tip_diameter / 2;
        let move_distance = |angle: f64| {
            if angle < half_pi { (angle.tan() * layer_height as f64) as i64 } else { i64::MAX }
        };
        let tip_layers = ((branch_radius - min_radius) / (support_line_width / 3)).max(branch_radius / layer_height);
        let tip_layers = tip_layers.max(1) as usize;
        let branch_radius_increase_per_layer =
            clamp(sp.tree_branch_diameter_angle, half_pi - 1e-4).tan() * layer_height as f64;
        let increase_radius_until_radius = branch_diameter / 2;
        let increase_radius_until_layer = if increase_radius_until_radius <= branch_radius {
            tip_layers * (increase_radius_until_radius / branch_radius.max(1)) as usize
        } else {
            ((increase_radius_until_radius - branch_radius) as f64 / branch_radius_increase_per_layer) as usize
        };
        let xy_min_distance = support_xy_distance.min(support_xy_distance_overhang);
        // Orca's defaults for what the presets don't set: a 7.5 mm base, 1 mm more by merges on the model, 1 mm
        // above the model before a branch may rest on it.
        let bp_radius = 7_500_000 / 2;
        let bp_radius_increase_per_layer = ((0.7f64).tan() * layer_height as f64).min(0.5 * support_line_width as f64);
        let support_top_distance = scaled(sp.top_z_distance);
        let support_bottom_distance = scaled(sp.bottom_z_distance);
        let layers = |d: i64| (d as f64 / layer_height as f64).round() as usize;
        Config {
            layer_height,
            first_layer_height_mm: s.first_layer_height,
            layer_height_mm: s.layer_height,
            resolution: scaled(s.resolution),
            min_feature_size: scaled(sp.min_feature_size),
            support_angle: half_pi - ((sp.threshold_angle + 1.0) * std::f64::consts::PI / 180.0).clamp(0.0, half_pi),
            threshold_degrees: if sp.threshold_angle > 1e-4 { (sp.threshold_angle + 1.0).min(89.0) } else { 30.0 },
            support_line_width,
            support_roof_line_width: support_line_width,
            support_bottom_enable,
            support_bottom_height: if support_bottom_enable { bottom_layers as i64 * layer_height } else { 0 },
            support_xy_distance,
            support_xy_distance_overhang,
            support_top_distance,
            support_bottom_distance,
            support_roof_layers: sp.top_interface_layers,
            support_floor_layers: bottom_layers,
            support_line_spacing: scaled(sp.base_spacing),
            support_wall_count: sp.wall_count.max(1),
            support_roof_line_distance: scaled(sp.interface_spacing) + support_line_width,
            branch_distance: scaled(sp.tree_branch_distance),
            tree_angle,
            tree_angle_slow,
            branch_diameter,
            branch_diameter_angle: clamp(sp.tree_branch_diameter_angle, half_pi - 1e-4),
            top_rate: sp.tree_top_rate,
            tip_diameter,
            remove_small_overhangs: sp.remove_small_overhang,
            branch_radius,
            min_radius,
            maximum_move_distance: move_distance(tree_angle),
            maximum_move_distance_slow: move_distance(tree_angle_slow),
            support_bottom_layers: if support_bottom_enable {
                ((bottom_layers as i64 * layer_height + layer_height / 2) / layer_height) as usize
            } else {
                0
            },
            tip_layers,
            branch_radius_increase_per_layer,
            max_to_model_radius_increase: 1_000_000 / 2,
            min_dtt_to_model: 1_000_000_usize.div_ceil(layer_height as usize),
            increase_radius_until_radius,
            increase_radius_until_layer,
            support_rests_on_model: !sp.on_build_plate_only,
            xy_distance: support_xy_distance,
            xy_min_distance,
            bp_radius,
            bp_radius_increase_per_layer,
            z_distance_bottom_layers: layers(support_bottom_distance),
            z_distance_top_layers: layers(support_top_distance),
            layer_start_bp_radius: ((bp_radius - branch_radius) as f64 / bp_radius_increase_per_layer) as i64,
        }
    }

    /// The radius of a branch `distance_to_top` layers below its tip, widened `elephant_foot_increases` times
    /// towards the plate (`getRadius`): the tip grows to the branch radius over its tip layers (in whole
    /// nanometres, as Orca's unsigned arithmetic), then by the diameter angle every layer.
    pub fn radius(&self, distance_to_top: usize, elephant_foot_increases: f64) -> i64 {
        let base = if distance_to_top <= self.tip_layers {
            (self.min_radius as u64
                + (self.branch_radius - self.min_radius) as u64 * distance_to_top as u64 / self.tip_layers as u64)
                as f64
        } else {
            self.branch_radius as f64
                + (distance_to_top - self.tip_layers) as f64 * self.branch_radius_increase_per_layer
        };
        (base
            + elephant_foot_increases
                * (self.bp_radius_increase_per_layer - self.branch_radius_increase_per_layer).max(0.0)) as i64
    }

    /// The radius a branch should at least have on `layer` (`recommendedMinRadius`): widening towards the plate.
    pub fn recommended_min_radius(&self, layer: i64) -> i64 {
        let widened = (self.layer_start_bp_radius - layer) as f64;
        if widened > 0.0 { (self.branch_radius as f64 + widened * self.bp_radius_increase_per_layer) as i64 } else { 0 }
    }

    /// mm: the top of the support's layer `layer` (`layer_z`: the object's layers, by formula).
    pub fn layer_z(&self, layer: usize) -> f64 {
        self.first_layer_height_mm + layer as f64 * self.layer_height_mm
    }
}

/// One object's trees before they are drawn: each support layer's branches, placed, and the roofs over them.
pub struct Branches {
    pub layers: Vec<Vec<grow::Element>>,
    /// Each support layer's contact roofs (right under the model) and interface roofs.
    pub contacts: Vec<Shapes>,
    pub interfaces: Vec<Shapes>,
}

/// The trees grown for an object whose layers' slices are `slices` (`heights` thick), about `origin` (units, the
/// middle of its bounding box), on a plate `bed` mm wide: its overhangs found, the model's volumes worked out, tips
/// seeded under the overhangs, grown down and placed. None where nothing needs support.
fn grown(
    slices: &[Shapes],
    heights: &[f64],
    s: &Settings,
    origin: (f64, f64),
    bed: [f64; 2],
) -> Option<(Config, volumes::Volumes, Branches)> {
    let c = Config::new(s);
    let found = overhangs::detect(slices, heights, &c, s);
    let areas = overhangs::areas(&found);
    // Support layers up to the highest overhang above the first layer, less the top gap (Orca's `precalculate`).
    let top = (1..areas.len()).rev().find(|&l| !areas[l].is_empty())?;
    let n = top.saturating_sub(c.z_distance_top_layers);
    if n == 0 {
        return None;
    }
    let v = volumes::Volumes::new(slices, &c, bed);
    v.precalculate(&c, n);
    let flow_spacing =
        (s.support.line_width as f32 - s.layer_height as f32 * (1.0 - 0.25 * std::f64::consts::PI) as f32) as f64;
    let roof_density = (flow_spacing / (s.support.interface_spacing + flow_spacing)).min(1.0);
    let mut seeder = seed::Seeder::new(&c, &v, origin, flow_spacing, roof_density, n);
    seeder.seed(&areas);
    let seeds = seeder.finish();
    let mut layers = seeds.layers;
    grow::grow(&c, &v, &mut layers);
    grow::place(&c, &v, &mut layers);
    Some((c, v, Branches { layers, contacts: seeds.contacts, interfaces: seeds.interfaces }))
}

/// The trees for an object (see `grown`), grown and placed but not drawn.
pub fn branches(
    slices: &[Shapes],
    heights: &[f64],
    s: &Settings,
    origin: (f64, f64),
    bed: [f64; 2],
) -> Option<Branches> {
    grown(slices, heights, s, origin, bed).map(|(_, _, b)| b)
}

/// An object's organic trees, drawn into the support's layers: each layer's branches, bottom contacts, and the
/// roofs' contact and interface layers, for `support::generate_tree` to print.
pub fn supports(
    slices: &[Shapes],
    heights: &[f64],
    s: &Settings,
    origin: (f64, f64),
    bed: [f64; 2],
) -> Option<crate::support::TreeLayers> {
    let (c, v, mut b) = grown(slices, heights, s, origin, bed)?;
    let drawn = draw::draw(&c, &v, &mut b.layers, &b.contacts, origin);
    let z = (0..b.layers.len()).map(|l| (if l > 0 { c.layer_z(l - 1) } else { 0.0 }, c.layer_z(l))).collect();
    Some(crate::support::TreeLayers {
        base: drawn.base,
        bottom_contacts: drawn.bottom_contacts,
        contacts: b.contacts,
        interfaces: b.interfaces,
        z,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The X2D's settings with Orca's organic trees, read as a setup would read them (which refuses trees until
    /// they slice).
    pub(crate) fn tree_settings() -> Settings {
        use crate::json::Json;
        use crate::profile::Profile;
        use std::collections::BTreeMap;
        let process = [("enable_support", "1"), ("support_type", "tree(auto)")]
            .iter()
            .map(|(k, v)| (k.to_string(), Json::String(v.to_string())))
            .collect();
        let profile = Profile::over_x2d(BTreeMap::new(), process, BTreeMap::new());
        Settings::from_profile(std::sync::Arc::new(profile), None)
    }

    #[test]
    fn a_ts_trees_start_under_its_roofs_and_reach_the_plate() {
        // The T of the normal supports' test: a 10 mm pillar 20 mm tall under a slab 40 mm wide, 5 mm thick.
        let s = tree_settings();
        let rect = |x0: f64, y0: f64, x1: f64, y1: f64| -> crate::geom::Shape {
            let p = |x: f64, y: f64| crate::geom::pt(crate::geom::sc(x), crate::geom::sc(y));
            vec![vec![p(x0, y0), p(x1, y0), p(x1, y1), p(x0, y1)]]
        };
        let slices: Vec<Shapes> =
            (0..125)
                .map(|l| {
                    if l < 100 {
                        vec![rect(115.0, 123.0, 125.0, 133.0)]
                    } else {
                        vec![rect(100.0, 123.0, 140.0, 133.0)]
                    }
                })
                .collect();
        let heights = vec![0.2; slices.len()];
        let origin = (crate::geom::sc(120.0) as f64, crate::geom::sc(128.0) as f64);
        let b = branches(&slices, &heights, &s, origin, [350.0, 320.0]).expect("trees");
        // Orca's: a contact roof on layer 98 (z 19.8), an interface under it, and the branches from layer 96 down.
        assert_eq!(b.layers.len(), 99);
        let with =
            |v: &[Shapes]| v.iter().enumerate().filter(|(_, a)| !a.is_empty()).map(|(l, _)| l).collect::<Vec<_>>();
        assert_eq!(with(&b.contacts), [98]);
        assert_eq!(with(&b.interfaces), [97]);
        assert!(b.layers[97].is_empty() && b.layers[98].is_empty() && !b.layers[96].is_empty());
        for (l, layer) in b.layers.iter().enumerate() {
            for e in layer {
                assert!(e.state.result_on_layer.is_some(), "an unplaced branch on layer {l}");
                for &p in &e.parents {
                    assert!(p < b.layers[l + 1].len());
                }
            }
        }
        assert!(!b.layers[0].is_empty(), "the trees reach the plate");
        // Two trunks, one under each arm, as wide as Orca's near the plate (its trunks stand at about x 106.3 and
        // 132.0 at z 1.0, 2.9 mm round).
        let c = Config::new(&s);
        let mut trunks: Vec<(f64, i64)> = b.layers[4]
            .iter()
            .map(|e| (crate::geom::unsc(e.state.result_on_layer.unwrap().x), c.element_radius(&e.state)))
            .collect();
        trunks.sort_by(|a, b| a.0.total_cmp(&b.0));
        assert_eq!(trunks.len(), 2);
        assert!((trunks[0].0 - 106.3).abs() < 1.5 && (trunks[1].0 - 132.0).abs() < 1.5, "{trunks:?}");
        assert!(trunks.iter().all(|t| t.1 == c.recommended_min_radius(4)));
    }

    #[test]
    fn the_x2d_trees_come_to_orcas_numbers() {
        let c = Config::new(&tree_settings());
        // Orca 2.5 with the X2D's 0.20 mm Standard process (spec: TreeSupportCommon.hpp).
        assert_eq!((c.layer_height, c.support_line_width, c.resolution), (200_000, 419_999, 12_000));
        assert_eq!((c.branch_radius, c.min_radius, c.tip_layers), (1_000_000, 400_000, 5));
        assert_eq!((c.maximum_move_distance, c.maximum_move_distance_slow), (167_819, 93_261));
        assert_eq!((c.xy_distance, c.xy_min_distance), (350_000, 209_999));
        assert_eq!((c.z_distance_top_layers, c.z_distance_bottom_layers, c.support_bottom_layers), (1, 1, 2));
        assert_eq!((c.min_dtt_to_model, c.increase_radius_until_layer, c.layer_start_bp_radius), (5, 5, 16));
        assert_eq!(c.min_feature_size, 25_000_000);
        assert!((c.branch_radius_increase_per_layer - 17_497.732_705_184_8).abs() < 1e-6);
        assert!((c.bp_radius_increase_per_layer - 168_457.676_092_615_87).abs() < 1e-6);
        // Radii: the tip grows 0.12 mm a layer to 1 mm, then 17.5 µm a layer; near the plate a branch aims wider.
        let radii: Vec<i64> = [0, 1, 5, 6, 20, 30, 50, 100, 200].iter().map(|&d| c.radius(d, 0.0)).collect();
        assert_eq!(
            radii,
            [400_000, 520_000, 1_000_000, 1_017_497, 1_262_465, 1_437_443, 1_787_397, 2_662_284, 4_412_057]
        );
        assert_eq!([0, 1, 15, 16].map(|l| c.recommended_min_radius(l)), [3_695_322, 3_526_865, 1_168_457, 0]);
    }
}
