//! The trees' growth (Orca's `create_layer_pathing` and `create_nodes_from_area`): from the tips down, layer by
//! layer, each branch's area (where its centre may be on that layer) moved and widened as far as it may go while it
//! still reaches the plate or the model, and the branches that meet merged into one; then, bottom up, each
//! branch's centre placed in its area, as near as it can be to the branch below it.
//!
//! Areas are in `geom`'s units; radii, distances and areas in Orca's nanometres (nm²).

use super::Config;
use super::util::{self, MITER};
use super::volumes::{Avoid, Volumes};
use crate::geom::{self, Pt, Shapes};
use crate::par;

/// nm²: an area this small counts as none (Orca's `tiny_area_threshold`, a micrometre squared).
const TINY: f64 = 1e6;

/// One way of growing an area a layer down (Orca's `AreaIncreaseSettings`).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Increase {
    pub kind: Avoid,
    pub speed: i64,
    pub increase_radius: bool,
    pub no_error: bool,
    pub use_min_distance: bool,
    pub moves: bool,
}

impl Default for Increase {
    fn default() -> Self {
        Increase {
            kind: Avoid::Fast,
            speed: 0,
            increase_radius: false,
            no_error: false,
            use_min_distance: false,
            moves: false,
        }
    }
}

/// A branch on one layer (Orca's `SupportElementState`).
#[derive(Clone, Debug)]
pub struct State {
    /// The layer of the tip this branch comes from, and the tip.
    pub target_height: usize,
    pub target_position: Pt,
    /// Where to put the branch's bottom.
    pub next_position: Pt,
    pub layer: usize,
    /// The layers below the tip whose radius the branch keeps off the model with (it may lag behind its drawn one).
    pub effective_radius_height: usize,
    pub distance_to_top: usize,
    /// The branch's centre, once placed.
    pub result_on_layer: Option<Pt>,
    pub increased_to_model_radius: i64,
    /// How far the branch has widened towards the plate, in layers' worth.
    pub elephant_foot_increases: f64,
    pub dont_move_until: usize,
    pub last_area_increase: Increase,
    pub to_buildplate: bool,
    pub to_model_gracious: bool,
    pub use_min_xy_dist: bool,
    pub supports_roof: bool,
    pub can_use_safe_radius: bool,
    pub skip_ovalisation: bool,
    pub lost: bool,
    pub verylost: bool,
    pub deleted: bool,
    pub marked: bool,
}

impl Default for State {
    fn default() -> Self {
        State {
            target_height: 0,
            target_position: geom::pt(0, 0),
            next_position: geom::pt(0, 0),
            layer: 0,
            effective_radius_height: 0,
            distance_to_top: 0,
            result_on_layer: None,
            increased_to_model_radius: 0,
            elephant_foot_increases: 0.0,
            dont_move_until: 0,
            last_area_increase: Increase::default(),
            to_buildplate: false,
            to_model_gracious: false,
            use_min_xy_dist: false,
            supports_roof: false,
            can_use_safe_radius: false,
            skip_ovalisation: false,
            lost: false,
            verylost: false,
            deleted: false,
            marked: false,
        }
    }
}

impl State {
    /// The state one layer further down (`propagate_down`), not yet placed.
    fn propagate_down(&self) -> State {
        let mut s = self.clone();
        s.distance_to_top += 1;
        s.layer -= 1;
        s.result_on_layer = None;
        s.skip_ovalisation = false;
        s
    }
}

/// A branch on one layer, with the branches above that it carries (indices into the layer above) and its area.
#[derive(Clone, Debug)]
pub struct Element {
    pub state: State,
    pub parents: Vec<usize>,
    pub area: Shapes,
}

impl Config {
    /// The layers below the tip that the drawn radius follows (`getEffectiveDTT`).
    fn effective_dtt(&self, s: &State) -> usize {
        if s.effective_radius_height < self.increase_radius_until_layer {
            s.distance_to_top.min(self.increase_radius_until_layer)
        } else {
            s.effective_radius_height
        }
    }

    /// The branch's drawn radius (`support_element_radius`).
    pub fn element_radius(&self, s: &State) -> i64 {
        self.radius(self.effective_dtt(s), s.elephant_foot_increases)
    }

    /// The radius the branch keeps off the model with (`support_element_collision_radius`).
    pub fn collision_radius(&self, s: &State) -> i64 {
        self.radius(s.effective_radius_height, s.elephant_foot_increases)
    }
}

/// A branch growing into the layer below, before merging (`SupportElementMerging`): where it may be, where it may
/// be to reach the plate, and to reach the model, with their bounding box (nm, 100 nm wider all round).
#[derive(Default)]
struct Merging {
    state: State,
    parents: Vec<usize>,
    influence: Shapes,
    to_bp: Shapes,
    to_model: Shapes,
    bbox: [i64; 4],
}

impl Merging {
    fn centroid(&self, dim: usize) -> i64 {
        (self.bbox[dim] + self.bbox[dim + 2]) / 2
    }
}

/// nm: the bounding box of areas, 100 nm wider all round (`set_bbox`), or the empty box.
fn bbox_nm(areas: &[&Shapes]) -> [i64; 4] {
    let mut b = [i64::MAX, i64::MAX, i64::MIN, i64::MIN];
    for a in areas {
        if let Some(e) = geom::bbox(a) {
            b = [b[0].min(e[0] as i64), b[1].min(e[1] as i64), b[2].max(e[2] as i64), b[3].max(e[3] as i64)];
        }
    }
    if b[0] > b[2] {
        // Eigen's empty box, whose middle is 0.
        return [i64::MAX, i64::MAX, i64::MIN, i64::MIN];
    }
    [b[0] * 100 - 100, b[1] * 100 - 100, b[2] * 100 + 100, b[3] * 100 + 100]
}

/// Grows the tips seeded in `layers` down to the plate or the model (`create_layer_pathing`): each layer's branches
/// grown into the layer below, then merged where they meet.
pub fn grow(c: &Config, v: &Volumes, layers: &mut [Vec<Element>]) {
    let n = layers.len();
    let mut last_merge = n;
    let mut new_element = false;
    // Cura's micrometre constants over nanometres: 0 but for absurdly thin layers, so every layer merges.
    let max_merge_every = (5000 / c.maximum_move_distance.max(100))
        .min(1000 / c.maximum_move_distance_slow.max(20))
        .min(3000 / c.layer_height) as usize;
    let mut merge_every = 1;
    for l in (1..n).rev() {
        if layers[l].is_empty() {
            continue;
        }
        let had_new = new_element;
        let merge_layer = had_new || last_merge - l >= merge_every;
        if had_new {
            merge_every = 1;
        }
        let grown: Vec<Option<Merging>> = {
            let prev = &layers[l];
            par::map_range(prev.len(), |i| increase(c, v, &prev[i], l, merge_layer))
        };
        let mut areas: Vec<Merging> = Vec::new();
        for (i, g) in grown.into_iter().enumerate() {
            match g {
                None => {
                    // No way down: the branch ends above, unplaced.
                    let p = &mut layers[l][i].state;
                    p.result_on_layer = None;
                    p.to_model_gracious = false;
                    p.verylost = true;
                }
                Some(mut m) => {
                    m.parents = vec![i];
                    if m.influence.is_empty() {
                        continue;
                    }
                    if m.to_bp.is_empty() && m.to_model.is_empty() {
                        // Bypasses merging.
                        layers[l - 1].push(Element { state: m.state, parents: m.parents, area: m.influence });
                    } else {
                        areas.push(m);
                    }
                }
            }
        }
        new_element = !layers[l - 1].is_empty();
        if merge_layer {
            if areas.len() > 1 {
                merge(c, v, l, &mut areas);
            }
            last_merge = l;
            // Merging keeps its slots, so it never counts as having reduced them.
            if !had_new {
                merge_every = max_merge_every.min(merge_every + 1);
            }
        }
        for m in areas {
            if !m.influence.is_empty() {
                let area = util::safe_union(&m.influence, &Vec::new());
                layers[l - 1].push(Element { state: m.state, parents: m.parents, area });
            }
        }
    }
}

/// The parent's branch grown a layer down (`increase_areas_one_layer` for one element): the first way of growing,
/// in Orca's order, that leaves it room, or none.
fn increase(c: &Config, v: &Volumes, parent: &Element, l: usize, merge_layer: bool) -> Option<Merging> {
    let ps = &parent.state;
    let mut elem = ps.propagate_down();
    let parent_radius = c.collision_radius(ps);
    let wall = v.wall_restriction(parent_radius, l, ps.use_min_xy_dist);
    let mut radius = c.collision_radius(&elem);
    let (max_move, max_slow) = (c.maximum_move_distance, c.maximum_move_distance_slow);
    let mut extra_speed: i64 = 5;
    let mut extra_slow_speed: i64 = 0;
    let ceiled_parent = v.ceil_radius_xy(parent_radius, ps.use_min_xy_dist);
    let projected = c.radius(ps.effective_radius_height + 1, ps.elephant_foot_increases);
    let projected_delta = projected - parent_radius;
    let smd = safe_movement(c, elem.use_min_xy_dist);
    if ceiled_parent == v.ceil_radius_xy(projected, ps.use_min_xy_dist) || projected < c.increase_radius_until_radius {
        extra_speed += projected_delta;
    } else {
        extra_slow_speed += projected_delta.min((max_move + extra_speed) - (max_slow + extra_slow_speed));
    }
    if c.layer_start_bp_radius > l as i64
        && c.recommended_min_radius(l as i64 - 1)
            < c.radius(elem.effective_radius_height + 1, elem.elephant_foot_increases)
    {
        let widened = c.radius(ps.effective_radius_height + 1, ps.elephant_foot_increases + 1.0);
        if ceiled_parent == v.ceil_radius_xy(widened, ps.use_min_xy_dist) {
            extra_speed = (extra_speed as f64 + c.bp_radius_increase_per_layer) as i64;
        } else {
            extra_slow_speed += (c.bp_radius_increase_per_layer as i64).min(max_move - (max_slow + extra_slow_speed));
        }
    }
    let fast = max_move + extra_speed;
    let slow = max_slow + extra_speed + extra_slow_speed;

    let order = attempts(c, v, parent, &elem, radius, l, merge_layer, fast, slow);

    let independent = radius / smd - i64::from(max_move + extra_speed < radius + smd)
        > (extra_speed + extra_slow_speed + max_slow + smd - 1) / smd;
    let mut offset_slow: Option<Shapes> = None;
    let mut offset_fast: Option<Shapes> = None;
    let (mut to_bp, mut to_model, mut inc_wo_collision) = (Vec::new(), Vec::new(), Vec::new());
    let mut add = false;
    let mut bypass = false;
    for s in &order {
        if s.moves {
            if offset_slow.is_none() && (s.speed == slow || !independent) {
                let unchecked = if independent { smd + radius } else { 0 };
                offset_slow = Some(util::safe_offset_inc(
                    &parent.area,
                    extra_speed + extra_slow_speed + max_slow,
                    wall,
                    smd,
                    unchecked,
                    2,
                ));
            }
            if offset_fast.is_none() && s.speed != slow {
                offset_fast = Some(if independent {
                    util::safe_offset_inc(&parent.area, extra_speed + max_move, wall, smd, smd + radius, 1)
                } else {
                    let base = offset_slow.as_ref().map_or(&parent.area, |o| o);
                    util::safe_offset_inc(base, max_move - (max_slow + extra_slow_speed), wall, smd, smd + radius, 1)
                });
            }
        }
        inc_wo_collision.clear();
        let result = if !s.no_error {
            // Branches that can't go on are pushed on faster than they should, from their area or its outline.
            let base = util::union(&parent.area, &util::outline_strips(&parent.area, 5_000.0));
            let overspeed = ((max_move + extra_speed) as f64 * 1.5) as i64;
            let grown = Grow { c, v, s, l, parent, merge_layer };
            grown.single(&base, &mut to_bp, &mut to_model, &mut inc_wo_collision, overspeed).map(|mut r| {
                r.lost = true;
                r
            })
        } else {
            let empty = Vec::new();
            let relevant = if s.speed == slow { offset_slow.as_ref() } else { offset_fast.as_ref() };
            let grown = Grow { c, v, s, l, parent, merge_layer };
            grown.single(relevant.unwrap_or(&empty), &mut to_bp, &mut to_model, &mut inc_wo_collision, 0)
        };
        if let Some(r) = result {
            elem = r;
            radius = c.collision_radius(&elem);
            elem.last_area_increase = *s;
            add = true;
            // Branches that stay put, or still keep only the smallest gap near their tip, don't merge.
            bypass = !s.moves || (s.use_min_distance && elem.distance_to_top < c.tip_layers);
            if s.moves {
                elem.dont_move_until = 0;
            } else {
                elem.result_on_layer = ps.result_on_layer;
            }
            elem.can_use_safe_radius = s.kind != Avoid::Fast;
            if !s.use_min_distance {
                elem.use_min_xy_dist = false;
            }
            break;
        }
    }
    if !add {
        return None;
    }
    let collision = v.collision(radius, l - 1, elem.use_min_xy_dist);
    let influence = util::safe_union(&util::diff(&inc_wo_collision, collision), &util::safe_union(&to_bp, &to_model));
    let bbox = bbox_nm(&[&influence]);
    let to_bp = if !bypass && elem.to_buildplate { to_bp } else { Vec::new() };
    let to_model = if !bypass && c.support_rests_on_model { to_model } else { Vec::new() };
    Some(Merging { state: elem, parents: Vec::new(), influence, to_bp, to_model, bbox })
}

/// nm: how far a branch may move between wall checks (`safe_movement_distance`): its gap, and with gaps above and
/// below, `min_feature_size` too.
fn safe_movement(c: &Config, use_min_xy_dist: bool) -> i64 {
    let gap = if use_min_xy_dist { c.xy_min_distance } else { c.xy_distance };
    let d = gap + if c.z_distance_top_layers.min(c.z_distance_bottom_layers) > 0 { c.min_feature_size } else { 0 };
    if d == 0 { 100_000 } else { d }
}

/// The ways of growing a branch to try, in Orca's order (`increase_areas_one_layer`'s `order`).
#[allow(clippy::too_many_arguments)]
fn attempts(
    c: &Config,
    v: &Volumes,
    parent: &Element,
    elem: &State,
    radius: i64,
    l: usize,
    merge_layer: bool,
    fast: i64,
    slow: i64,
) -> Vec<Increase> {
    let mut order: Vec<Increase> = Vec::new();
    let insert = |order: &mut Vec<Increase>, s: Increase, back: bool| {
        if !order.contains(&s) {
            if back { order.push(s) } else { order.insert(0, s) }
        }
    };
    let set = |kind, speed, increase_radius, no_error, use_min_distance, moves| Increase {
        kind,
        speed,
        increase_radius,
        no_error,
        use_min_distance,
        moves,
    };
    let last = elem.last_area_increase;
    let parent_moved_slow = last.speed < c.maximum_move_distance;
    let mismatch = parent_moved_slow && last.kind != Avoid::Slow;
    if last.moves
        && last.no_error
        && elem.can_use_safe_radius
        && !merge_layer
        && !mismatch
        && (elem.distance_to_top >= c.tip_layers || parent_moved_slow)
    {
        let speed = if parent_moved_slow { slow } else { fast };
        insert(&mut order, set(last.kind, speed, true, last.no_error, false, last.moves), true);
        insert(&mut order, set(last.kind, speed, false, last.no_error, false, last.moves), true);
    }
    use Avoid::{Fast, FastSafe, Slow};
    if !elem.can_use_safe_radius {
        insert(&mut order, set(Slow, slow, true, true, false, false), true);
        if elem.distance_to_top < c.tip_layers.div_ceil(2) {
            insert(&mut order, set(Fast, slow, true, true, false, false), true);
        }
        insert(&mut order, set(FastSafe, fast, true, true, false, false), true);
        insert(&mut order, set(FastSafe, fast, false, true, false, true), true);
        insert(&mut order, set(Fast, fast, false, true, false, true), true);
    } else {
        insert(&mut order, set(Slow, slow, true, true, false, true), true);
        insert(&mut order, set(Slow, slow, false, true, false, true), true);
        if elem.distance_to_top < c.tip_layers {
            insert(&mut order, set(FastSafe, slow, true, true, false, true), true);
        }
        insert(&mut order, set(FastSafe, fast, true, true, false, true), true);
        insert(&mut order, set(FastSafe, fast, false, true, false, true), true);
    }
    if elem.use_min_xy_dist {
        // Each with the regular gap first, then with the smallest.
        order = order.into_iter().flat_map(|s| [s, Increase { use_min_distance: true, ..s }]).collect();
    }
    if elem.to_buildplate
        || (elem.to_model_gracious && util::intersection(&parent.area, v.placeable(radius, l)).is_empty())
    {
        insert(&mut order, set(Fast, fast, false, false, elem.use_min_xy_dist, true), true);
    }
    if elem.distance_to_top < elem.dont_move_until && elem.can_use_safe_radius {
        insert(&mut order, set(Slow, 0, true, true, false, false), false);
    }
    order
}

/// One attempt at growing a branch a layer down.
struct Grow<'a> {
    c: &'a Config,
    v: &'a Volumes,
    s: &'a Increase,
    l: usize,
    parent: &'a Element,
    merge_layer: bool,
}

impl<'a> Grow<'a> {
    /// Where a branch of radius `r` must not be on the layer below: to reach the plate, or the model (`gracious`:
    /// standing on it, else just not in it).
    fn away(&self, r: i64, to_model: bool, gracious: bool) -> &'a Shapes {
        let (v, s, umd) = (self.v, self.s, self.s.use_min_distance);
        if !to_model {
            v.avoidance(r, self.l - 1, s.kind, false, umd)
        } else if gracious {
            v.avoidance(r, self.l - 1, s.kind, true, umd)
        } else {
            v.collision(r, self.l - 1, umd)
        }
    }

    /// Whether a branch of radius `next` would still have room in `increased`, where it has room with `now`.
    fn valid(&self, increased: &Shapes, next: i64, now: i64, cur: &State) -> bool {
        let umd = self.s.use_min_distance;
        if self.v.ceil_radius_xy(next, umd) <= self.v.ceil_radius_xy(now, umd) {
            return true;
        }
        let left = if cur.to_buildplate {
            util::area(&util::diff(increased, self.away(next, false, true)))
        } else if self.c.support_rests_on_model {
            util::area(&util::diff(increased, self.away(next, true, cur.to_model_gracious)))
        } else {
            0.0
        };
        left > TINY
    }

    /// The branch grown with this attempt's way (`increase_single_area`), if it leaves it room: `relevant` is the
    /// parent's area moved as far as it may; `to_bp` and `to_model` become where the branch may be to reach the
    /// plate or the model, `increased` where it may be at all.
    fn single(
        &self,
        relevant: &Shapes,
        to_bp: &mut Shapes,
        to_model: &mut Shapes,
        increased: &mut Shapes,
        overspeed: i64,
    ) -> Option<State> {
        let (c, v, s, l) = (self.c, self.v, self.s, self.l);
        let ps = &self.parent.state;
        let mut cur = ps.propagate_down();
        if s.increase_radius {
            cur.effective_radius_height += 1;
        }
        let mut radius = c.collision_radius(&cur);
        let umd = s.use_min_distance;
        let lm1 = l - 1;
        if s.moves {
            *increased = relevant.clone();
            if overspeed > 0 {
                let smd = safe_movement(c, cur.use_min_xy_dist);
                let wall = v.wall_restriction(c.collision_radius(ps), l, ps.use_min_xy_dist);
                *increased = util::safe_offset_inc(increased, overspeed, wall, smd, smd + radius, 1);
            }
            // (Orca simplifies a copy here and drops it.)
        } else {
            *increased = self.parent.area.clone();
        }
        let none = Vec::new();
        let away = |r: i64, to_model: bool, gracious: bool| self.away(r, to_model, gracious);
        if self.merge_layer || cur.to_buildplate {
            *to_bp = util::safe_union(&util::diff(increased, away(radius, false, true)), &none);
            if !cur.to_buildplate && util::area(to_bp) > TINY {
                // Corrects a branch wrongly marked as not reaching the plate.
                cur.to_buildplate = true;
            }
        }
        if c.support_rests_on_model {
            if self.merge_layer || cur.to_model_gracious {
                *to_model = util::safe_union(&util::diff(increased, away(radius, true, true)), &none);
            }
            if !cur.to_model_gracious {
                if self.merge_layer && util::area(to_model) >= TINY {
                    cur.to_model_gracious = true;
                } else {
                    *to_model = util::safe_union(&util::diff(increased, away(radius, true, false)), &none);
                }
            }
        }
        let mut check = util::area(if cur.to_buildplate { to_bp } else { to_model });
        if s.increase_radius && check > TINY {
            let increased: &Shapes = increased;
            let valid = |next: i64, now: i64, cur: &State| self.valid(increased, next, now, cur);
            let ceil_before = v.ceil_radius_xy(radius, umd);
            let collision_radius = c.collision_radius(&cur);
            let element_radius = c.element_radius(&cur);
            if collision_radius < c.increase_radius_until_radius && collision_radius < element_radius {
                // The collision radius lags the drawn one: catch up as far as there is room.
                let target = element_radius.min(c.increase_radius_until_radius);
                let mut ceil = v.radius_next_ceil(radius, umd);
                while ceil < target && valid(v.radius_next_ceil(ceil + 1, umd), radius, &cur) {
                    ceil = v.radius_next_ceil(ceil + 1, umd);
                }
                let mut erh = cur.effective_radius_height;
                let efi = cur.elephant_foot_increases;
                while erh + 1 < cur.distance_to_top
                    && c.radius(erh + 1, efi) <= ceil
                    && c.radius(erh + 1, efi) <= element_radius
                {
                    erh += 1;
                }
                cur.effective_radius_height = erh;
            }
            radius = c.collision_radius(&cur);
            let foot = (c.bp_radius_increase_per_layer - c.branch_radius_increase_per_layer).max(0.0) as i64;
            let element_radius = c.element_radius(&cur);
            let planned = (1.0f64).min((c.recommended_min_radius(lm1 as i64) - element_radius) as f64 / foot as f64);
            if planned > 0.0
                && cur.to_buildplate
                && element_radius >= c.branch_radius
                && element_radius >= c.increase_radius_until_radius
                && valid(c.radius(cur.effective_radius_height, cur.elephant_foot_increases + planned), radius, &cur)
            {
                cur.elephant_foot_increases += planned;
                radius = c.collision_radius(&cur);
            }
            if ceil_before != v.ceil_radius_xy(radius, umd) {
                if cur.to_buildplate {
                    *to_bp = util::safe_union(&util::diff(increased, away(radius, false, true)), &none);
                }
                if c.support_rests_on_model && (!cur.to_buildplate || self.merge_layer) {
                    *to_model =
                        util::safe_union(&util::diff(increased, away(radius, true, cur.to_model_gracious)), &none);
                }
                check = util::area(if cur.to_buildplate { to_bp } else { to_model });
            }
        }
        (check > TINY).then_some(cur)
    }
}

/// Merges the branches of one layer that meet (`merge_influence_areas`): sorted along a bounding-box tree, merged
/// within buckets of four, then bucket pairs merged into one another until one is left. Merged-away slots are left
/// empty.
fn merge(c: &Config, v: &Volumes, l: usize, areas: &mut [Merging]) {
    let n = areas.len();
    if n == 0 {
        return;
    }
    aabb_order(areas, 0, n - 1);
    let first = (n + 2) / 4;
    if first == 0 {
        return;
    }
    let mut buckets: Vec<(usize, usize)> = (0..first).map(|i| (4 * i, 4 * i + 4)).collect();
    match buckets.last_mut() {
        Some(last) if last.1 >= n => last.1 = n,
        _ => buckets.push((4 * first, n)),
    }
    // The first round: within each bucket, all but a lone one left over.
    {
        let end = buckets[first - 1].1;
        let chunks: Vec<&mut [Merging]> = areas[..end].chunks_mut(4).collect();
        let ends = par::map_vec(chunks, |chunk| merge_leaves(c, v, l, chunk));
        for (i, e) in ends.into_iter().enumerate() {
            buckets[i].1 = buckets[i].0 + e;
        }
    }
    while buckets.len() > 1 {
        let pairs = buckets.len() / 2;
        let mut parts: Vec<(&mut [Merging], usize, usize)> = Vec::with_capacity(pairs);
        let mut rest: &mut [Merging] = areas;
        let mut at = 0;
        for i in 0..pairs {
            let (d, s) = (buckets[2 * i], buckets[2 * i + 1]);
            let tail = std::mem::take(&mut rest);
            let (_, tail) = tail.split_at_mut(d.0 - at);
            let (part, tail) = tail.split_at_mut(s.1 - d.0);
            rest = tail;
            at = s.1;
            parts.push((part, d.1 - d.0, s.0 - d.0));
        }
        let ends = par::map_vec(parts, |(part, d_end, s_begin)| merge_two_sets(c, v, l, part, d_end, s_begin));
        for (i, e) in ends.into_iter().enumerate() {
            buckets[2 * i].1 = buckets[2 * i].0 + e;
        }
        let kept = buckets.len().div_ceil(2);
        for i in 1..kept {
            buckets[i] = buckets[2 * i];
        }
        buckets.truncate(kept);
    }
}

/// Two distinct slots of a slice, mutably.
fn pair(v: &mut [Merging], i: usize, j: usize) -> (&mut Merging, &mut Merging) {
    if i < j {
        let (a, b) = v.split_at_mut(j);
        (&mut a[i], &mut b[0])
    } else {
        let (a, b) = v.split_at_mut(i);
        (&mut b[0], &mut a[j])
    }
}

/// Merges a bucket's branches into one another (`merge_influence_areas_leaves`): the new end of its live slots.
fn merge_leaves(c: &Config, v: &Volumes, l: usize, part: &mut [Merging]) -> usize {
    let mut end = part.len();
    let mut i = 0;
    while i + 1 < end {
        let mut merged = false;
        let mut j = i + 1;
        while j != end {
            let (dst, src) = pair(part, i, j);
            if merge_two(c, v, l, dst, src) {
                end -= 1;
                if j != end {
                    part[j] = std::mem::take(&mut part[end]);
                }
                merged = true;
                break;
            }
            j += 1;
        }
        if !merged {
            i += 1;
        }
    }
    end
}

/// Merges a bucket's branches (`[s_begin, len)`) into the one before it (`[0, d_end)`)
/// (`merge_influence_areas_two_sets`): the new end of the live slots, which it packs at the front.
fn merge_two_sets(c: &Config, v: &Volumes, l: usize, part: &mut [Merging], d_end: usize, s_begin: usize) -> usize {
    let s_end = part.len();
    let (mut d_end, mut s_begin) = (d_end, s_begin);
    for src in s_begin..s_end {
        let mut dst = 0;
        let mut merged = None;
        while dst != d_end {
            let (d, s) = pair(part, dst, src);
            if merge_two(c, v, l, d, s) {
                merged = Some(dst);
                dst += 1;
                if src != s_begin {
                    part[src] = std::mem::take(&mut part[s_begin]);
                }
                s_begin += 1;
                break;
            }
            dst += 1;
        }
        if let Some(m) = merged {
            // The grown branch may now take in branches after it.
            while dst != d_end {
                let (d, s) = pair(part, m, dst);
                if merge_two(c, v, l, d, s) {
                    d_end -= 1;
                    if dst != d_end {
                        part[dst] = std::mem::take(&mut part[d_end]);
                    }
                } else {
                    dst += 1;
                }
            }
        }
    }
    if d_end == s_begin {
        s_end
    } else {
        while s_begin != s_end {
            part[d_end] = std::mem::take(&mut part[s_begin]);
            d_end += 1;
            s_begin += 1;
        }
        d_end
    }
}

/// Merges `src` into `dst` if their areas meet well enough (`merge_influence_areas_two_elements`); `src` is left
/// empty.
fn merge_two(c: &Config, v: &Volumes, l: usize, dst: &mut Merging, src: &mut Merging) -> bool {
    let (ds, ss) = (&dst.state, &src.state);
    if ds.to_model_gracious != ss.to_model_gracious || ds.use_min_xy_dist != ss.use_min_xy_dist {
        return false;
    }
    let dst_bigger = c.collision_radius(ds) > c.collision_radius(ss);
    let (small, big): (&Merging, &Merging) = if dst_bigger { (src, dst) } else { (dst, src) };
    let delta = (c.element_radius(&big.state) - c.element_radius(&small.state)).abs();
    let (sb, bb) = (small.bbox, big.bbox);
    let sb = [sb[0] - delta, sb[1] - delta, sb[2] + delta, sb[3] + delta];
    if !(sb[0] <= bb[2] && sb[1] <= bb[3] && bb[0] <= sb[2] && bb[1] <= sb[3]) {
        return false;
    }
    let mut to_model_increase = 0;
    let to_bp = ds.to_buildplate && ss.to_buildplate;
    if !to_bp {
        if ds.to_buildplate != ss.to_buildplate {
            // A branch to the plate merging into one to the model widens it: only so far.
            let (rdst, rsrc) = (c.element_radius(ds), c.element_radius(ss));
            if ds.to_buildplate {
                if rsrc < rdst {
                    to_model_increase = ss.increased_to_model_radius + rdst - rsrc;
                }
            } else if rsrc > rdst {
                to_model_increase = ds.increased_to_model_radius + rsrc - rdst;
            }
            if to_model_increase > c.max_to_model_radius_increase {
                return false;
            }
        }
        if !ds.supports_roof && !ss.supports_roof && ss.distance_to_top.max(ds.distance_to_top) < c.min_dtt_to_model {
            return false;
        }
    }
    if !big.state.can_use_safe_radius && small.state.can_use_safe_radius {
        return false;
    }
    let use_min = big.state.use_min_xy_dist && small.state.use_min_xy_dist;
    let small_radius = c.collision_radius(&small.state);
    let collision = v.collision(small_radius, l - 1, use_min);
    let step = 2 * (c.xy_distance + small_radius - 3);
    // The smaller branch's area widened to the bigger's radius, where it meets the bigger's.
    let meet = |a: &Shapes, b: &Shapes| util::intersection(&util::safe_offset_inc(a, delta, collision, step, 0, 0), b);
    let inter = if to_bp { meet(&small.to_bp, &big.to_bp) } else { meet(&small.to_model, &big.to_model) };
    if util::area(&inter) <= TINY || util::area(&util::offset(&inter, -25_000.0, MITER)) <= TINY {
        return false;
    }
    let next = util::move_inside_if_outside(&inter, ds.next_position);
    let mut state = merge_states(c, ds, ss, next, l - 1);
    state.increased_to_model_radius = if to_model_increase == 0 {
        ds.increased_to_model_radius.max(ss.increased_to_model_radius)
    } else {
        to_model_increase
    };
    let influence = util::safe_union(&meet(&small.influence, &big.influence), &inter);
    let to_model = if to_bp && c.support_rests_on_model {
        if state.to_model_gracious {
            util::safe_union(&meet(&small.to_model, &big.to_model), &inter)
        } else {
            influence.clone()
        }
    } else {
        Vec::new()
    };
    let parents = std::mem::take(&mut src.parents);
    *src = Merging::default();
    dst.parents.extend(parents);
    dst.state = state;
    dst.influence = influence;
    if to_bp {
        dst.to_bp = inter;
        dst.to_model = if c.support_rests_on_model { to_model } else { Vec::new() };
    } else {
        dst.to_bp = Vec::new();
        dst.to_model = inter;
    }
    dst.bbox = bbox_nm(&[&dst.influence, &dst.to_bp, &dst.to_model]);
    true
}

/// Two branches' states as one (`merge_support_element_states`).
fn merge_states(c: &Config, first: &State, second: &State, next: Pt, layer: usize) -> State {
    let (target_height, target_position) = if first.target_height > second.target_height {
        (first.target_height, first.target_position)
    } else {
        (second.target_height, second.target_position)
    };
    let (a, b) = (first.last_area_increase, second.last_area_increase);
    let mut out = State {
        next_position: next,
        layer,
        use_min_xy_dist: first.use_min_xy_dist || second.use_min_xy_dist,
        supports_roof: first.supports_roof || second.supports_roof,
        dont_move_until: first.dont_move_until.max(second.dont_move_until),
        can_use_safe_radius: first.can_use_safe_radius || second.can_use_safe_radius,
        target_height,
        target_position,
        effective_radius_height: first.effective_radius_height.max(second.effective_radius_height),
        distance_to_top: first.distance_to_top.max(second.distance_to_top),
        to_buildplate: first.to_buildplate && second.to_buildplate,
        to_model_gracious: first.to_model_gracious && second.to_model_gracious,
        last_area_increase: Increase {
            kind: a.kind.min(b.kind),
            speed: a.speed.min(b.speed),
            increase_radius: a.increase_radius || b.increase_radius,
            no_error: a.no_error || b.no_error,
            use_min_distance: a.use_min_distance && b.use_min_distance,
            moves: a.moves || b.moves,
        },
        ..State::default()
    };
    if c.bp_radius_increase_per_layer > 0.0 {
        // The foot widened so that the merged radius is the bigger of the two.
        let foot = (c.collision_radius(second).max(c.collision_radius(first)) - c.collision_radius(&out)).abs();
        out.elephant_foot_increases =
            foot as f64 / (c.bp_radius_increase_per_layer - c.branch_radius_increase_per_layer);
    }
    out
}

/// Orders the branches as Orca's bounding-box tree leaves them (`build_modify_input`): split in halves along the
/// longer side, each half by quickselect on the middles of their boxes.
fn aabb_order(v: &mut [Merging], lo: usize, hi: usize) {
    if lo == hi {
        return;
    }
    let mut b = v[lo].bbox;
    for m in &v[lo + 1..=hi] {
        b = [b[0].min(m.bbox[0]), b[1].min(m.bbox[1]), b[2].max(m.bbox[2]), b[3].max(m.bbox[3])];
    }
    let dim = if b[2] - b[0] >= b[3] - b[1] { 0 } else { 1 };
    let mid = (lo + hi) / 2;
    partition(v, dim, lo, hi, mid);
    aabb_order(v, lo, mid);
    aabb_order(v, mid + 1, hi);
}

/// Orca's quickselect (`partition_input`), median of three, with its swaps.
fn partition(v: &mut [Merging], dim: usize, mut left: usize, mut right: usize, k: usize) {
    while left < right {
        let center = (left + right) / 2;
        let mut lv = v[left].centroid(dim);
        let mut cv = v[center].centroid(dim);
        let mut rv = v[right].centroid(dim);
        if lv > cv {
            v.swap(left, center);
            std::mem::swap(&mut lv, &mut cv);
        }
        if lv > rv {
            v.swap(left, right);
            rv = lv;
        }
        if cv > rv {
            v.swap(center, right);
            cv = rv;
        }
        let pivot = cv;
        if right <= left + 2 {
            break;
        }
        let mut i = left;
        let mut j = right - 1;
        v.swap(center, j);
        loop {
            loop {
                i += 1;
                if v[i].centroid(dim) >= pivot {
                    break;
                }
            }
            loop {
                j -= 1;
                if !(v[j].centroid(dim) > pivot && i < j) {
                    break;
                }
            }
            if i >= j {
                break;
            }
            v.swap(i, j);
        }
        v.swap(i, right - 1);
        match k.cmp(&i) {
            std::cmp::Ordering::Less => right = i - 1,
            std::cmp::Ordering::Equal => break,
            std::cmp::Ordering::Greater => left = i + 1,
        }
    }
}

/// Places every branch (`create_nodes_from_area`): bottom up, each branch's centre in its area as near as it can be
/// to the branch below; branches that end in the air, too short to stand on the model, or carrying nothing, go.
pub fn place(c: &Config, v: &Volumes, layers: &mut [Vec<Element>]) {
    let n = layers.len();
    if n == 0 {
        return;
    }
    if n > 1 {
        for e in &mut layers[1] {
            e.state.marked = false;
        }
    }
    for i in 0..layers[0].len() {
        let e = &mut layers[0][i];
        e.state.result_on_layer = Some(util::move_inside_if_outside(&e.area, e.state.next_position));
        set_points(layers, 0, i);
    }
    for l in 1..n {
        if l + 1 < n {
            for e in &mut layers[l + 1] {
                e.state.marked = false;
            }
        }
        for i in 0..layers[l].len() {
            // Orca's release build processes elements already deleted by a walk below, too.
            if layers[l][i].state.result_on_layer.is_none() {
                let s = &layers[l][i].state;
                if s.to_buildplate || (s.distance_to_top < c.min_dtt_to_model && !s.supports_roof) {
                    layers[l][i].state.deleted = true;
                } else if s.to_model_gracious {
                    rest_on_model(c, v, layers, l, i);
                } else {
                    let e = &mut layers[l][i];
                    e.state.result_on_layer = Some(util::move_inside_if_outside(&e.area, e.state.next_position));
                }
            }
            let s = &layers[l][i].state;
            if !s.deleted && !s.marked && s.target_height == l {
                layers[l][i].state.deleted = true;
            }
            if layers[l][i].state.deleted {
                let (below, above) = layers.split_at_mut(l + 1);
                for &p in &below[l][i].parents {
                    above[0][p].state.result_on_layer = None;
                }
            } else {
                set_points(layers, l, i);
            }
        }
    }
    remove_deleted(layers);
}

/// Places the parents of a placed branch (`set_points_on_areas`) as near to it as their areas let them, unless
/// they already have a place, and marks them carried.
fn set_points(layers: &mut [Vec<Element>], l: usize, i: usize) {
    let (below, above) = layers.split_at_mut(l + 1);
    let e = &below[l][i];
    let Some(at) = e.state.result_on_layer else { return };
    let Some(above) = above.first_mut() else { return };
    for &p in &e.parents {
        let parent = &mut above[p];
        if parent.state.result_on_layer.is_none() {
            parent.state.result_on_layer = Some(util::move_inside_if_outside(&parent.area, at));
        }
        parent.state.marked = true;
    }
}

/// Rests a branch that ends on the model on the highest layer of the run up from it where it fits on the model
/// (`set_to_model_contact_to_model_gracious`), dropping the elements below that; where it fits nowhere, it rests
/// where it ends.
fn rest_on_model(c: &Config, v: &Volumes, layers: &mut [Vec<Element>], l: usize, i: usize) {
    let mut last: Option<(usize, usize)> = None;
    let (mut layer, mut index) = (l, i);
    loop {
        let e = &layers[layer][index];
        if util::intersection(&e.area, v.placeable(c.collision_radius(&e.state), layer)).is_empty() {
            break;
        }
        last = Some((layer, index));
        if e.parents.len() != 1 {
            break;
        }
        index = e.parents[0];
        layer += 1;
    }
    match last {
        None => {
            let e = &mut layers[l][i];
            e.state.to_model_gracious = false;
            e.state.result_on_layer = Some(util::move_inside_if_outside(&e.area, e.state.next_position));
        }
        Some((top, top_index)) => {
            let (mut layer, mut index) = (l, i);
            while (layer, index) != (top, top_index) {
                layers[layer][index].state.deleted = true;
                index = layers[layer][index].parents[0];
                layer += 1;
            }
            let e = &mut layers[top][top_index];
            e.state.result_on_layer = Some(util::move_inside_if_outside(&e.area, e.state.next_position));
        }
    }
}

/// Drops deleted elements, top layer first, renumbering the parents of those below (`remove_deleted_elements`):
/// a deleted slot takes the layer's last element.
fn remove_deleted(layers: &mut [Vec<Element>]) {
    let mut map_parents: Vec<i64> = Vec::new();
    let mut map_current: Vec<i64> = Vec::new();
    for layer in layers.iter_mut().rev() {
        map_current.clear();
        let mut i = 0;
        while i < layer.len() {
            if layer[i].state.deleted {
                if map_current.is_empty() {
                    map_current = (0..layer.len() as i64).collect();
                }
                while i < layer.len() && layer.last().is_some_and(|e| e.state.deleted) {
                    layer.pop();
                    map_current[layer.len()] = -1;
                }
                if i + 1 < layer.len() {
                    let moved = layer.pop().expect("a live element");
                    layer[i] = moved;
                    map_current[i] = -1;
                    map_current[layer.len()] = i as i64;
                }
            } else {
                if !map_parents.is_empty() {
                    // (A live element never carries a deleted one; were it to, it would lose it rather than fail.)
                    let parents = std::mem::take(&mut layer[i].parents);
                    layer[i].parents =
                        parents.into_iter().filter_map(|p| usize::try_from(map_parents[p]).ok()).collect();
                }
                i += 1;
            }
        }
        std::mem::swap(&mut map_current, &mut map_parents);
    }
}
