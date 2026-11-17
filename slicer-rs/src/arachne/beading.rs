//! Arachne's beading strategies: how many beads of what widths cover a wall of a given thickness, and where the bead
//! count changes. Ported from Orca 2.5.1's `Arachne/BeadingStrategy/*` and `BeadingStrategyFactory.cpp`, in the same
//! integer arithmetic (nanometres, `i64` as Orca's `coord_t`) and with the same truncations: where Orca multiplies an
//! integer by a `double` or a `float` and converts back, so does this (the distributed strategy's weights are `float`s).
//!
//! The strategies stack as the factory stacks them: limited ( outer wall inset ( widening ( redistribute ( distributed
//! ))))), each a [`BeadingStrategy`] that holds its parent and asks it for what it doesn't change.

/// What Orca's `scaled<coord_t>(mm)` does: millimetres to nanometres, truncating.
pub fn scaled(mm: f64) -> i64 {
    (mm / 0.000001) as i64
}

/// The beads covering a thickness (`BeadingStrategy::Beading`).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Beading {
    pub total_thickness: i64,
    /// The line width of each bead from the outer inset inward.
    pub bead_widths: Vec<i64>,
    /// The distance of each bead's toolpath from the outline.
    pub toolpath_locations: Vec<i64>,
    /// The distance not covered by any bead; gap area.
    pub left_over: i64,
}

/// The fields every strategy has (`BeadingStrategy`'s members); the stacked strategies copy their parent's.
#[derive(Clone, Debug)]
pub struct Base {
    /// Nominal bead width in ideal circumstances.
    pub optimal_width: i64,
    /// When a middle wall splits into two, as a ratio of the optimal width.
    pub wall_split_middle_threshold: f64,
    /// When a new middle wall is added between an even number of walls, as a ratio of the optimal width.
    pub wall_add_middle_threshold: f64,
    /// The length of the region that transfers smoothly between bead counts.
    pub default_transition_length: i64,
    /// The largest angle between outline segments for which transitions are added (a `float`, as Orca's).
    pub transitioning_angle: f32,
}

/// `BeadingStrategy`: virtual methods with Orca's base class' defaults.
pub trait BeadingStrategy {
    fn base(&self) -> &Base;

    /// The beads for `thickness` with `bead_count` of them (which may differ from the optimal count).
    fn compute(&self, thickness: i64, bead_count: i64) -> Beading;

    /// The number of beads to use for a thickness.
    fn get_optimal_bead_count(&self, thickness: i64) -> i64;

    /// The ideal thickness for a bead count.
    fn get_optimal_thickness(&self, bead_count: i64) -> i64 {
        self.base().optimal_width * bead_count
    }

    /// The thickness at which the optimal bead count goes from `lower_bead_count` to one more.
    fn get_transition_thickness(&self, lower_bead_count: i64) -> i64 {
        let lower_ideal_width = self.get_optimal_thickness(lower_bead_count);
        let higher_ideal_width = self.get_optimal_thickness(lower_bead_count + 1);
        let b = self.base();
        let threshold =
            if lower_bead_count % 2 == 1 { b.wall_split_middle_threshold } else { b.wall_add_middle_threshold };
        (lower_ideal_width as f64 + threshold * (higher_ideal_width - lower_ideal_width) as f64) as i64
    }

    /// The length of the transitioning region along the central parts of the skeleton.
    fn get_transitioning_length(&self, lower_bead_count: i64) -> i64 {
        if lower_bead_count == 0 {
            return scaled(0.01);
        }
        self.base().default_transition_length
    }

    /// The fraction of the transition length between the lower end of the transition and where the count jumps.
    fn get_transition_anchor_pos(&self, lower_bead_count: i64) -> f32 {
        let lower_optimum = self.get_optimal_thickness(lower_bead_count);
        let transition_point = self.get_transition_thickness(lower_bead_count);
        let upper_optimum = self.get_optimal_thickness(lower_bead_count + 1);
        // `1.0 - float(a) / float(b)`: the double 1.0 minus a float, returned as a float.
        (1.0 - (((transition_point - lower_optimum) as f32) / ((upper_optimum - lower_optimum) as f32)) as f64) as f32
    }

    /// The thicknesses in a bead count's region where `compute`'s widths bend, lower to higher.
    fn get_nonlinear_thicknesses(&self, _lower_bead_count: i64) -> Vec<i64> {
        Vec::new()
    }

    fn get_split_middle_threshold(&self) -> f64 {
        self.base().wall_split_middle_threshold
    }

    fn get_transitioning_angle(&self) -> f64 {
        f64::from(self.base().transitioning_angle)
    }
}

/// `DistributedBeadingStrategy`: the bead count that deviates least from the optimal width, the beads spread over the
/// thickness, the discrepancy shared among the middle ones.
pub struct Distributed {
    base: Base,
    /// (1 / distribution radius)², a `float`.
    one_over_distribution_radius_squared: f32,
}

impl Distributed {
    pub fn new(
        optimal_width: i64,
        default_transition_length: i64,
        transitioning_angle: f64,
        wall_split_middle_threshold: f64,
        wall_add_middle_threshold: f64,
        distribution_radius: i32,
    ) -> Distributed {
        let one_over = if distribution_radius >= 2 {
            let d = (distribution_radius - 1) as f32;
            1.0f32 / d * 1.0f32 / d
        } else {
            1.0f32 // Orca: 1.0f / 1 * 1.0f / 1
        };
        Distributed {
            base: Base {
                optimal_width,
                wall_split_middle_threshold,
                wall_add_middle_threshold,
                default_transition_length,
                transitioning_angle: transitioning_angle as f32,
            },
            one_over_distribution_radius_squared: one_over,
        }
    }
}

impl BeadingStrategy for Distributed {
    fn base(&self) -> &Base {
        &self.base
    }

    fn compute(&self, thickness: i64, bead_count: i64) -> Beading {
        let mut ret = Beading { total_thickness: thickness, ..Beading::default() };
        let optimal_width = self.base.optimal_width;
        if bead_count > 2 {
            let to_be_divided = thickness - bead_count * optimal_width;
            let middle = (bead_count - 1) as f32 / 2.0;
            let one_over = self.one_over_distribution_radius_squared;
            let weight = |idx: i64| -> f32 {
                let dev = idx as f32 - middle;
                (1.0f32 - one_over * dev * dev).max(0.0)
            };
            let weights: Vec<f32> = (0..bead_count).map(weight).collect();
            let mut total_weight = 0.0f32;
            for w in &weights {
                total_weight += *w;
            }
            let mut accumulated_width = 0i64;
            for idx in 0..bead_count {
                let weight_fraction = weights[idx as usize] / total_weight;
                let splitup_left_over_weight = (to_be_divided as f32 * weight_fraction) as i64;
                let width = if idx == bead_count - 1 {
                    thickness - accumulated_width
                } else {
                    optimal_width + splitup_left_over_weight
                };
                if idx == 0 {
                    ret.toolpath_locations.push(width / 2);
                } else {
                    let last = ret.toolpath_locations[ret.toolpath_locations.len() - 1];
                    let last_width = ret.bead_widths[ret.bead_widths.len() - 1];
                    ret.toolpath_locations.push(last + (last_width + width) / 2);
                }
                ret.bead_widths.push(width);
                accumulated_width += width;
            }
            ret.left_over = 0;
        } else if bead_count == 2 {
            let outer_width = thickness / 2;
            ret.bead_widths.push(outer_width);
            ret.bead_widths.push(outer_width);
            ret.toolpath_locations.push(outer_width / 2);
            ret.toolpath_locations.push(thickness - outer_width / 2);
            ret.left_over = 0;
        } else if bead_count == 1 {
            let outer_width = thickness;
            ret.bead_widths.push(outer_width);
            ret.toolpath_locations.push(outer_width / 2);
            ret.left_over = 0;
        } else {
            ret.left_over = thickness;
        }
        ret
    }

    fn get_optimal_bead_count(&self, thickness: i64) -> i64 {
        let w = self.base.optimal_width;
        let naive_count = thickness / w;
        let remainder = thickness - naive_count * w;
        let threshold = if naive_count % 2 == 1 {
            self.base.wall_split_middle_threshold
        } else {
            self.base.wall_add_middle_threshold
        };
        let minimum_line_width = (w as f64 * threshold) as i64;
        naive_count + i64::from(remainder >= minimum_line_width)
    }
}

/// `RedistributeBeadingStrategy`: the two outermost beads at a fixed width (the outer wall's), the rest left to the
/// parent.
pub struct Redistribute {
    base: Base,
    parent: Box<dyn BeadingStrategy>,
    optimal_width_outer: i64,
    minimum_variable_line_ratio: f64,
}

impl Redistribute {
    pub fn new(
        optimal_width_outer: i64,
        minimum_variable_line_ratio: f64,
        parent: Box<dyn BeadingStrategy>,
    ) -> Redistribute {
        Redistribute { base: parent.base().clone(), parent, optimal_width_outer, minimum_variable_line_ratio }
    }
}

impl BeadingStrategy for Redistribute {
    fn base(&self) -> &Base {
        &self.base
    }

    fn compute(&self, thickness: i64, bead_count: i64) -> Beading {
        let mut ret = Beading::default();
        let outer = self.optimal_width_outer;
        // No lines at all:
        if bead_count == 0 || (thickness as f64) < self.minimum_variable_line_ratio * outer as f64 {
            ret.left_over = thickness;
            ret.total_thickness = thickness;
            return ret;
        }
        // The inner walls, if any:
        let inner_bead_count = bead_count - 2;
        let inner_thickness = thickness - 2 * outer;
        if inner_bead_count > 0 && inner_thickness > 0 {
            ret = self.parent.compute(inner_thickness, inner_bead_count);
            for loc in &mut ret.toolpath_locations {
                *loc += outer;
            }
        }
        // The outer walls around them:
        let actual_outer_thickness = if bead_count > 2 { (thickness / 2).min(outer) } else { thickness / bead_count };
        ret.bead_widths.insert(0, actual_outer_thickness);
        ret.toolpath_locations.insert(0, actual_outer_thickness / 2);
        if bead_count > 1 {
            ret.bead_widths.push(actual_outer_thickness);
            ret.toolpath_locations.push(thickness - actual_outer_thickness / 2);
        }
        ret.total_thickness = thickness;
        ret.left_over = thickness - ret.bead_widths.iter().sum::<i64>();
        ret
    }

    fn get_optimal_thickness(&self, bead_count: i64) -> i64 {
        let inner_bead_count = (bead_count - 2).max(0);
        let outer_bead_count = bead_count - inner_bead_count;
        self.parent.get_optimal_thickness(inner_bead_count) + self.optimal_width_outer * outer_bead_count
    }

    fn get_transition_thickness(&self, lower_bead_count: i64) -> i64 {
        match lower_bead_count {
            0 => (self.minimum_variable_line_ratio * self.optimal_width_outer as f64) as i64,
            1 => ((1.0 + self.parent.get_split_middle_threshold()) * self.optimal_width_outer as f64) as i64,
            _ => self.parent.get_transition_thickness(lower_bead_count - 2) + 2 * self.optimal_width_outer,
        }
    }

    fn get_optimal_bead_count(&self, thickness: i64) -> i64 {
        let outer = self.optimal_width_outer;
        if (thickness as f64) < self.minimum_variable_line_ratio * outer as f64 {
            return 0;
        }
        if thickness <= 2 * outer {
            return if thickness as f64 > (1.0 + self.parent.get_split_middle_threshold()) * outer as f64 {
                2
            } else {
                1
            };
        }
        self.parent.get_optimal_bead_count(thickness - 2 * outer) + 2
    }

    fn get_transitioning_length(&self, lower_bead_count: i64) -> i64 {
        self.parent.get_transitioning_length(lower_bead_count)
    }

    fn get_transition_anchor_pos(&self, lower_bead_count: i64) -> f32 {
        self.parent.get_transition_anchor_pos(lower_bead_count)
    }
}

/// `WideningBeadingStrategy`: a wall too thin for a bead of the minimum width gets one at least that wide (as long as
/// it is at least `min_input_width` thick).
pub struct Widening {
    base: Base,
    parent: Box<dyn BeadingStrategy>,
    min_input_width: i64,
    min_output_width: i64,
}

impl Widening {
    pub fn new(parent: Box<dyn BeadingStrategy>, min_input_width: i64, min_output_width: i64) -> Widening {
        Widening { base: parent.base().clone(), parent, min_input_width, min_output_width }
    }
}

impl BeadingStrategy for Widening {
    fn base(&self) -> &Base {
        &self.base
    }

    fn compute(&self, thickness: i64, bead_count: i64) -> Beading {
        // Orca 2.5.1 (its #14376): one bead at the full thickness only where at most one is asked for.
        if bead_count <= 1 && thickness < self.get_transition_thickness(1) {
            let mut ret = Beading { total_thickness: thickness, ..Beading::default() };
            if thickness >= self.min_input_width {
                ret.bead_widths.push(thickness.max(self.min_output_width));
                ret.toolpath_locations.push(thickness / 2);
                ret.left_over = 0;
            } else {
                ret.left_over = thickness;
            }
            ret
        } else {
            self.parent.compute(thickness, bead_count)
        }
    }

    fn get_optimal_thickness(&self, bead_count: i64) -> i64 {
        self.parent.get_optimal_thickness(bead_count)
    }

    fn get_transition_thickness(&self, lower_bead_count: i64) -> i64 {
        if lower_bead_count == 0 {
            self.min_input_width
        } else {
            self.parent.get_transition_thickness(lower_bead_count)
        }
    }

    fn get_optimal_bead_count(&self, thickness: i64) -> i64 {
        if thickness < self.min_input_width {
            return 0;
        }
        self.parent.get_optimal_bead_count(thickness).max(1)
    }

    fn get_transitioning_length(&self, lower_bead_count: i64) -> i64 {
        self.parent.get_transitioning_length(lower_bead_count)
    }

    fn get_transition_anchor_pos(&self, lower_bead_count: i64) -> f32 {
        self.parent.get_transition_anchor_pos(lower_bead_count)
    }

    fn get_nonlinear_thicknesses(&self, lower_bead_count: i64) -> Vec<i64> {
        let mut ret = vec![self.min_output_width];
        ret.extend(self.parent.get_nonlinear_thicknesses(lower_bead_count));
        ret
    }
}

/// `OuterWallInsetBeadingStrategy`: the outer bead's toolpath moved inwards (`wall_0_inset`).
pub struct OuterWallInset {
    base: Base,
    parent: Box<dyn BeadingStrategy>,
    outer_wall_offset: i64,
}

impl OuterWallInset {
    pub fn new(outer_wall_offset: i64, parent: Box<dyn BeadingStrategy>) -> OuterWallInset {
        OuterWallInset { base: parent.base().clone(), parent, outer_wall_offset }
    }
}

impl BeadingStrategy for OuterWallInset {
    fn base(&self) -> &Base {
        &self.base
    }

    fn compute(&self, thickness: i64, bead_count: i64) -> Beading {
        let mut ret = self.parent.compute(thickness, bead_count);
        // Not the zero-width beads that only signal an edge.
        let count = ret.bead_widths.iter().filter(|&&w| w > 0).count();
        if count < 2 {
            return ret;
        }
        // The outer wall never goes beyond the middle line.
        ret.toolpath_locations[0] = (ret.toolpath_locations[0] + self.outer_wall_offset).min(thickness / 2);
        ret
    }

    fn get_optimal_thickness(&self, bead_count: i64) -> i64 {
        self.parent.get_optimal_thickness(bead_count)
    }

    fn get_transition_thickness(&self, lower_bead_count: i64) -> i64 {
        self.parent.get_transition_thickness(lower_bead_count)
    }

    fn get_optimal_bead_count(&self, thickness: i64) -> i64 {
        self.parent.get_optimal_bead_count(thickness)
    }

    fn get_transitioning_length(&self, lower_bead_count: i64) -> i64 {
        self.parent.get_transitioning_length(lower_bead_count)
    }
}

/// `LimitedBeadingStrategy`: at most `max_bead_count` beads; one bead more is asked for to say "the wall is thicker
/// than that", and gets the maximum, with a zero-width bead at each inner edge for the infill to meet.
pub struct Limited {
    base: Base,
    max_bead_count: i64,
    parent: Box<dyn BeadingStrategy>,
}

impl Limited {
    pub fn new(max_bead_count: i64, parent: Box<dyn BeadingStrategy>) -> Limited {
        Limited { base: parent.base().clone(), max_bead_count, parent }
    }
}

impl BeadingStrategy for Limited {
    fn base(&self) -> &Base {
        &self.base
    }

    fn compute(&self, thickness: i64, bead_count: i64) -> Beading {
        let max = self.max_bead_count;
        if bead_count <= max {
            let mut ret = self.parent.compute(thickness, bead_count);
            let count = ret.toolpath_locations.len() as i64;
            // Orca indexes `max / 2 - 1` here, which is undefined below two beads.
            if count % 2 == 0 && count == max && max >= 2 {
                let at = (max / 2) as usize;
                let location = ret.toolpath_locations[at - 1];
                let width = ret.bead_widths[at - 1];
                ret.toolpath_locations.insert(at, location + width / 2);
                ret.bead_widths.insert(at, 0);
            }
            return ret;
        }
        let optimal_thickness = self.parent.get_optimal_thickness(max);
        let mut ret = self.parent.compute(optimal_thickness, max);
        let bead_count = ret.toolpath_locations.len() as i64;
        ret.left_over += thickness - ret.total_thickness;
        ret.total_thickness = thickness;
        // Orca would index before the first bead for fewer than two.
        if max < 2 {
            return ret;
        }
        // Enforce symmetry.
        if bead_count % 2 == 1 {
            ret.toolpath_locations[(bead_count / 2) as usize] = thickness / 2;
            ret.bead_widths[(bead_count / 2) as usize] = thickness - optimal_thickness;
        }
        for idx in 0..(bead_count + 1) / 2 {
            ret.toolpath_locations[(bead_count - 1 - idx) as usize] = thickness - ret.toolpath_locations[idx as usize];
        }
        // A "fake" inner wall of no width marks the edge of the walled area.
        let at = (max / 2) as usize;
        let location = ret.toolpath_locations[at - 1];
        let width = ret.bead_widths[at - 1];
        ret.toolpath_locations.insert(at, location + width / 2);
        ret.bead_widths.insert(at, 0);
        // And the same on the other side.
        let opposite = (bead_count - (max / 2 - 1)) as usize;
        let location = ret.toolpath_locations[opposite];
        let width = ret.bead_widths[opposite];
        ret.toolpath_locations.insert(opposite, location - width / 2);
        ret.bead_widths.insert(opposite, 0);
        ret
    }

    fn get_optimal_thickness(&self, bead_count: i64) -> i64 {
        if bead_count <= self.max_bead_count {
            return self.parent.get_optimal_thickness(bead_count);
        }
        scaled(1000.0) // a metre (Orca asserts this is never asked)
    }

    fn get_transition_thickness(&self, lower_bead_count: i64) -> i64 {
        if lower_bead_count < self.max_bead_count {
            return self.parent.get_transition_thickness(lower_bead_count);
        }
        if lower_bead_count == self.max_bead_count {
            return self.parent.get_optimal_thickness(lower_bead_count + 1) - scaled(0.01);
        }
        scaled(900.0) // Orca asserts this is never asked
    }

    fn get_optimal_bead_count(&self, thickness: i64) -> i64 {
        let max = self.max_bead_count;
        let parent_bead_count = self.parent.get_optimal_bead_count(thickness);
        if parent_bead_count <= max {
            parent_bead_count
        } else if parent_bead_count == max + 1 {
            if thickness < self.parent.get_optimal_thickness(max + 1) - scaled(0.01) { max } else { max + 1 }
        } else {
            max + 1
        }
    }

    fn get_transitioning_length(&self, lower_bead_count: i64) -> i64 {
        self.parent.get_transitioning_length(lower_bead_count)
    }

    fn get_transition_anchor_pos(&self, lower_bead_count: i64) -> f32 {
        self.parent.get_transition_anchor_pos(lower_bead_count)
    }
}

/// `BeadingStrategyFactory::makeStrategy`'s arguments, with the defaults of its header.
#[derive(Clone, Debug)]
pub struct Params {
    pub preferred_bead_width_outer: i64,
    pub preferred_bead_width_inner: i64,
    pub preferred_transition_length: i64,
    pub transitioning_angle: f32,
    pub print_thin_walls: bool,
    pub min_bead_width: i64,
    pub min_feature_size: i64,
    pub wall_split_middle_threshold: f64,
    pub wall_add_middle_threshold: f64,
    pub max_bead_count: i64,
    pub outer_wall_offset: i64,
    pub inward_distributed_center_wall_count: i32,
    pub minimum_variable_line_ratio: f64,
}

impl Default for Params {
    fn default() -> Params {
        Params {
            preferred_bead_width_outer: scaled(0.0005),
            preferred_bead_width_inner: scaled(0.0005),
            preferred_transition_length: scaled(0.0004),
            transitioning_angle: (std::f64::consts::PI / 4.0) as f32,
            print_thin_walls: false,
            min_bead_width: 0,
            min_feature_size: 0,
            wall_split_middle_threshold: 0.5,
            wall_add_middle_threshold: 0.5,
            max_bead_count: 0,
            outer_wall_offset: 0,
            inward_distributed_center_wall_count: 2,
            minimum_variable_line_ratio: 0.5,
        }
    }
}

/// `BeadingStrategyFactory::makeStrategy`: distributed, redistributed with the outer wall's width, widened for thin
/// walls, the outer wall inset, limited to `max_bead_count` beads.
pub fn make_strategy(p: &Params) -> Box<dyn BeadingStrategy> {
    let optimal_width = if p.max_bead_count <= 2 { p.preferred_bead_width_outer } else { p.preferred_bead_width_inner };
    let mut ret: Box<dyn BeadingStrategy> = Box::new(Distributed::new(
        optimal_width,
        p.preferred_transition_length,
        f64::from(p.transitioning_angle),
        p.wall_split_middle_threshold,
        p.wall_add_middle_threshold,
        p.inward_distributed_center_wall_count,
    ));
    ret = Box::new(Redistribute::new(p.preferred_bead_width_outer, p.minimum_variable_line_ratio, ret));
    if p.print_thin_walls {
        ret = Box::new(Widening::new(ret, p.min_feature_size, p.min_bead_width));
    }
    if p.outer_wall_offset != 0 {
        ret = Box::new(OuterWallInset::new(p.outer_wall_offset, ret));
    }
    Box::new(Limited::new(p.max_bead_count, ret))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fmt::Write;

    /// The strategies of Orca's check (`dump.cpp`, built from Orca 2.5.1's own `BeadingStrategy/*.cpp`): the
    /// nozzles' stacks as the app's setup makes them.
    fn stacks() -> Vec<(String, Params)> {
        let mut out = Vec::new();
        for (name, w0, wx, nozzle) in [("n04", 0.42, 0.45, 0.4), ("n02", 0.22, 0.22, 0.2), ("n06", 0.62, 0.66, 0.6)] {
            let (w0, wx, nozzle): (f64, f64, f64) = (w0, wx, nozzle);
            let min_bead = 0.85 * nozzle;
            let split = (2.0 * min_bead / w0 - 1.0).clamp(0.01, 0.99);
            let add = (min_bead / wx).clamp(0.01, 0.99);
            for max in [2, 4, 6, 8] {
                for inset in [0, scaled(0.02)] {
                    for dist in [1, 2, 3] {
                        for thin in [true, false] {
                            if max != 4 && (inset != 0 || dist != 1 || !thin) {
                                continue;
                            }
                            out.push((
                                format!("{name}_mb{max}_i{inset}_d{dist}_{}", if thin { "t" } else { "n" }),
                                Params {
                                    preferred_bead_width_outer: scaled(w0),
                                    preferred_bead_width_inner: scaled(wx),
                                    preferred_transition_length: scaled(nozzle),
                                    transitioning_angle: (10.0 * std::f64::consts::PI / 180.0) as f32,
                                    print_thin_walls: thin,
                                    min_bead_width: scaled(min_bead),
                                    min_feature_size: scaled(0.25 * nozzle),
                                    wall_split_middle_threshold: split,
                                    wall_add_middle_threshold: add,
                                    max_bead_count: max,
                                    outer_wall_offset: inset,
                                    inward_distributed_center_wall_count: dist,
                                    minimum_variable_line_ratio: 0.5,
                                },
                            ));
                        }
                    }
                }
            }
        }
        out
    }

    struct Fnv(u64);

    impl Fnv {
        fn put(&mut self, v: i64) {
            for i in 0..8 {
                self.0 ^= ((v >> (8 * i)) & 0xff) as u64;
                self.0 = self.0.wrapping_mul(1099511628211);
            }
        }
    }

    /// Dump.cpp's output: `fine` hashes every micron, else the readable lines at a 613 µm stride for some stacks.
    fn dump(fine: bool) -> (String, u64) {
        let mut text = String::new();
        let mut h = Fnv(1469598103934665603);
        for (name, p) in stacks() {
            let st = make_strategy(&p);
            if !fine {
                if !name.starts_with("n04_") && name != "n02_mb4_i0_d1_t" && name != "n06_mb2_i0_d1_t" {
                    continue;
                }
                writeln!(text, "strategy {name}").unwrap();
            }
            for k in 0..=p.max_bead_count {
                let ot = st.get_optimal_thickness(k);
                let tt = st.get_transition_thickness(k);
                let tl = st.get_transitioning_length(k);
                let ap = st.get_transition_anchor_pos(k).to_bits();
                let nl = st.get_nonlinear_thicknesses(k);
                for v in [ot, tt, tl, i64::from(ap)] {
                    h.put(v);
                }
                for &v in &nl {
                    h.put(v);
                }
                if !fine {
                    write!(text, "k {k} ot {ot} tt {tt} tl {tl} ap {ap:08x} nl").unwrap();
                    for v in &nl {
                        write!(text, " {v}").unwrap();
                    }
                    text.push('\n');
                }
            }
            let step = if fine { 1000 } else { 613_000 };
            let maxt = 10 * p.preferred_transition_length;
            let mut t = 0;
            while t <= maxt {
                let oc = st.get_optimal_bead_count(t);
                h.put(oc);
                let mut counts: std::collections::BTreeSet<i64> =
                    [0, 1, 2, 3, p.max_bead_count, p.max_bead_count + 1].into();
                for d in -1..=1 {
                    if oc + d >= 0 {
                        counts.insert(oc + d);
                    }
                }
                if !fine {
                    writeln!(text, "t {t} oc {oc}").unwrap();
                }
                for &c in &counts {
                    if c > p.max_bead_count + 1 {
                        continue;
                    }
                    let b = st.compute(t, c);
                    for v in [t, c, b.total_thickness, b.left_over] {
                        h.put(v);
                    }
                    for &w in &b.bead_widths {
                        h.put(w);
                    }
                    for &l in &b.toolpath_locations {
                        h.put(l);
                    }
                    if !fine {
                        write!(text, " c {c} tot {} left {} w", b.total_thickness, b.left_over).unwrap();
                        for w in &b.bead_widths {
                            write!(text, " {w}").unwrap();
                        }
                        text.push_str(" l");
                        for l in &b.toolpath_locations {
                            write!(text, " {l}").unwrap();
                        }
                        text.push('\n');
                    }
                }
                t += step;
            }
        }
        (text, h.0)
    }

    #[test]
    fn matches_orcas_readable_dump() {
        let (text, hash) = dump(false);
        let expected = include_str!("../../tests/arachne/beading.txt");
        let (body, last) = expected.rsplit_once("hash ").unwrap();
        assert_eq!(format!("{hash:016x}"), last.trim());
        for (n, (a, b)) in text.lines().zip(body.lines()).enumerate() {
            assert_eq!(a, b, "line {}", n + 1);
        }
        assert_eq!(text.lines().count(), body.lines().count());
    }

    /// Every micron of every thickness up to ten transition lengths, for all the stacks: Orca's hash over the same.
    #[test]
    fn matches_orcas_hash_at_every_micron() {
        let (_, hash) = dump(true);
        assert_eq!(format!("{hash:016x}"), include_str!("../../tests/arachne/beading-hash.txt").trim());
    }

    #[test]
    fn a_wall_of_two_nozzles() {
        // The defaults: a 0.4 mm nozzle with 0.45 mm lines and 3 walls (6 beads), 0.8 mm thick: two beads of 0.4.
        let p = Params {
            preferred_bead_width_outer: 450_000,
            preferred_bead_width_inner: 450_000,
            max_bead_count: 6,
            ..Params::default()
        };
        let st = make_strategy(&p);
        assert_eq!(st.get_optimal_bead_count(900_000), 2);
        let b = st.compute(900_000, 2);
        assert_eq!(b.bead_widths, vec![450_000, 450_000]);
        assert_eq!(b.toolpath_locations, vec![225_000, 675_000]);
        assert_eq!(b.left_over, 0);
        // Thicker than six beads: six, with zero-width beads marking the edge of the walls' area.
        let b = st.compute(5_000_000, 7);
        assert_eq!(b.bead_widths.len(), 8);
        assert_eq!(b.bead_widths.iter().filter(|&&w| w == 0).count(), 2);
    }
}
