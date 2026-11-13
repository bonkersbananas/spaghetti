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

pub mod overhangs;
pub mod volumes;

use crate::config::Settings;

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
