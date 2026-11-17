//! Spiral vase mode, as Orca prints it. Above its bottom layers a vase is sliced to its outline's largest loop alone,
//! holes filled (`section.rs`), and walled once (`region.rs`); its bottom's last layer is all top surface and every
//! layer above it all inside, with nothing to fill at Orca's forced 0 % sparse infill. Each loop starts at the point
//! nearest where the nozzle is (`plan.rs`), and a layer that is one wall loop and nothing else rises as it goes
//! round: its moves are rewritten here as Orca's `SpiralVase::process_layer` rewrites its G-code, the height climbing
//! from the layer below's top to its own along the loop, travels, retractions and lifts dropped. The first such
//! layer's flow ramps up from `spiral_starting_flow_ratio`; the print's last runs round again flat, its flow ramping
//! down to `spiral_finishing_flow_ratio`.

use crate::config::Settings;
use crate::fmath::Hyp;
use crate::gcode::{FORM_E, FORM_Z, Kind, LayerGcode, Move};
use crate::geom::{self, Pt, Shapes};
use crate::plan::LayerPlan;
use crate::region::Role;
use crate::section::Layers;

/// Orca's `EPSILON`, mm.
const EPSILON: f64 = 1e-4;

/// The first layer sliced to its outline's largest loop: past the bottom's layers and its thickness, as Orca's
/// `slicing_mode_normal_below_layer` counts them (by where each layer is cut).
pub fn first_layer(layers: &Layers, s: &Settings) -> usize {
    let zs = layers.slice_z();
    let mut k = s.bottom_shell_layers;
    while k < zs.len() && zs[k] < s.bottom_shell_thickness - EPSILON {
        k += 1;
    }
    k
}

/// Whether layer `i` (its top at `print_z`) keeps its outer wall's largest loop alone, as Orca's walls do in spiral
/// vase mode (`LayerRegion::make_perimeters`).
pub fn largest_wall(i: usize, print_z: f64, s: &Settings) -> bool {
    s.spiral_mode && i >= s.bottom_shell_layers && print_z >= s.bottom_shell_thickness - EPSILON
}

/// Orca's surfaces in spiral vase mode (`detect_surfaces_type`): found as ever below the bottom's last layer, which
/// is all top surface; every layer above it is inside, neither top nor bottom.
pub fn surfaces(tops: &mut [Shapes], bottoms: &mut [Shapes], slices: &[Shapes], s: &Settings) {
    let n = tops.len().min(bottoms.len()).min(slices.len());
    let bottom = s.bottom_shell_layers.min(n);
    let found = if bottom > 1 { bottom - 1 } else { bottom };
    for i in found..n {
        tops[i].clear();
        bottoms[i].clear();
    }
    if bottom > 1 {
        tops[bottom - 1] = slices[bottom - 1].clone();
    }
}

/// What a spiral vase print's layer is beyond its plan: where the nozzle comes from, and how its loop rises.
#[derive(Clone, Debug, Default)]
pub struct Course {
    /// Where the nozzle is as the layer begins: the layer before's end, at its height.
    pub from: [f64; 3],
    /// The first layer that rises: its flow ramps up.
    pub first: bool,
    /// The print's last layer: one that rises runs round again flat, its flow ramping down; then the nozzle retracts
    /// and lifts, as Orca's does before the end G-code.
    pub last: bool,
    /// The turn below's points as written, which a smoothed spiral eases away from.
    pub below: Vec<[f64; 2]>,
    /// What the layer before ended printing, and how wide: the G-code names a feature and a width only where they
    /// change, from one layer to the next as well.
    pub before: Option<(Role, f32)>,
}

/// Where a spiral vase print is as its layers are planned one after another (`lib.rs`).
pub struct State {
    /// Where Orca's writer reckons the nozzle is: the plate's origin before the first layer, then each layer's end.
    pub at: Pt,
    /// Where it is: where the start G-code leaves it, then each layer's end, at its height.
    from: [f64; 3],
    /// Whether the layer before rose.
    rising: bool,
    /// The last turn's points as written.
    below: Vec<[f64; 2]>,
    /// What the layer before ended printing, and how wide.
    before: Option<(Role, f32)>,
}

impl State {
    pub fn new(start: [f64; 3]) -> State {
        State { at: geom::pt(0, 0), from: start, rising: false, below: Vec::new(), before: None }
    }

    /// Gives a layer planned from `at` (its top at `z`; `last`, the print's last) its course, and moves on to its
    /// end. Returns the height the nozzle comes onto the layer at: the layer before's, as nothing lifts at a layer's
    /// end in spiral vase mode (Orca turns off retracting at layer changes there).
    pub fn course(&mut self, plan: &mut LayerPlan, z: f64, last: bool, s: &Settings) -> f64 {
        let from_z = self.from[2];
        plan.course = Some(Course {
            from: self.from,
            first: plan.spiral && !self.rising,
            last,
            below: self.below.clone(),
            before: self.before,
        });
        self.rising = plan.spiral;
        match plan.paths.last() {
            Some(p) if !p.points.is_empty() => {
                let end = p.points[p.points.len() - 1];
                self.at = end;
                self.from = [geom::unsc(end.x), geom::unsc(end.y), z];
                let role = p.last_role();
                let width = if role == Role::OverhangWall {
                    crate::plan::overhang_flow(plan.index == 0, plan.height, s).0
                } else {
                    p.width
                };
                self.before = Some((role, width as f32));
            }
            _ => self.from[2] = z,
        }
        from_z
    }

    /// Keeps the last turn's points (with smoothing on), which the next turn eases away from.
    pub fn turned(&mut self, layers: &[LayerGcode]) {
        for l in layers {
            if !l.turn.is_empty() {
                self.below = l.turn.clone();
            }
        }
    }
}

/// A rising layer's moves, rewritten.
pub(crate) struct Rise {
    pub moves: Vec<Move>,
    /// For each of the layer's moves (and one past them), where what was said before it now goes.
    pub at: Vec<usize>,
    /// The flat run round again on the print's last layer: where it starts in `moves`, and for each move (and one
    /// past them) where what was said before it goes in it.
    pub again: Option<(usize, Vec<usize>)>,
    /// The turn's points as written, for the next turn's smoothing.
    pub points: Vec<[f64; 2]>,
}

/// Orca's G-code numbers: what it reads back from the text it wrote (three decimals for positions, five for the
/// filament).
fn mm3(v: f64) -> f64 {
    (v * 1000.0).round() / 1000.0
}

fn e5(v: f64) -> f64 {
    (v * 100_000.0).round() / 100_000.0
}

/// Rewrites a rising layer's `moves` as Orca's `SpiralVase::process_layer` rewrites its G-code, the nozzle at
/// `course.from` before the first. Its extrusions climb from the height the layer's first move to a new height
/// names (less the layer's rise, all its moves to new heights together) by its height, each by its share of their
/// length so far; moves that only change the height stay, at the height it starts from; travels, retractions,
/// their undoing and extrusions shorter than twice the resolution go. On the first layer that rises the flow ramps
/// up from the starting ratio to all of it; on the print's last the extrusions run again flat after it, the flow
/// ramping down from all of it to the finishing ratio.
pub(crate) fn rise(moves: &[Move], course: &Course, s: &Settings) -> Rise {
    let spiral = &s.spiral;
    let min_segment = EPSILON.max(2.0 * s.resolution);
    // What the reader makes of the layer first: its extrusions' length and its rise.
    let (mut total, mut rise, mut start_z) = (0.0, 0.0, None);
    let mut at = course.from;
    for m in moves {
        let d = (mm3(m.x) - mm3(at[0])).hyp(mm3(m.y) - mm3(at[1]));
        let extruding = m.e > 0.0 && m.kind != Kind::Wipe;
        if extruding {
            total += d;
        } else if matches!(m.kind, Kind::Lift | Kind::TravelZ) {
            rise += mm3(m.z) - mm3(at[2]);
            start_z.get_or_insert(mm3(m.z));
        }
        at = [m.x, m.y, m.z];
    }
    let z0 = start_z.unwrap_or(mm3(course.from[2])) - rise;
    let ramp_in = course.first;
    let ramp_out = course.last;
    let mut out = Rise {
        moves: Vec::with_capacity(moves.len()),
        at: Vec::with_capacity(moves.len() + 1),
        again: None,
        points: Vec::new(),
    };
    let mut again: Vec<Move> = Vec::new();
    let mut again_at: Vec<usize> = Vec::with_capacity(moves.len() + 1);
    let mut len = 0.0;
    let mut last_point = course.below.last().copied().unwrap_or([0.0, 0.0]);
    let smooth_below = (spiral.smooth && !course.below.is_empty()).then_some(course.below.as_slice());
    let mut at = course.from;
    let mut z_now = z0;
    for m in moves {
        out.at.push(out.moves.len());
        again_at.push(again.len());
        let d = (mm3(m.x) - mm3(at[0])).hyp(mm3(m.y) - mm3(at[1]));
        at = [m.x, m.y, m.z];
        let extruding = m.e > 0.0 && m.kind != Kind::Wipe;
        let retracting = m.e < 0.0;
        if retracting || (extruding && d < min_segment) {
            continue;
        }
        match m.kind {
            Kind::Lift => {
                // A move up or down alone stays, at the height the layer starts from.
                out.moves.push(Move { z: z0, form: FORM_Z, ..*m });
                z_now = z0;
            }
            Kind::Extrude(_) if d > 0.0 => {
                len += d;
                let factor = if total > 0.0 { len / total } else { 1.0 };
                let mut line = *m;
                let e = e5(m.e);
                if ramp_in {
                    line.e = e5(e * (spiral.starting_flow + factor * (1.0 - spiral.starting_flow)));
                    line.form |= FORM_E;
                } else if ramp_out {
                    let mut flat = *m;
                    flat.e = e5(e * (spiral.finishing_flow + (1.0 - factor) * (1.0 - spiral.finishing_flow)));
                    flat.form |= FORM_E;
                    again.push(flat);
                }
                line.z = mm3(z0 + factor * rise);
                line.form |= FORM_Z;
                if let Some(below) = smooth_below {
                    let p = [mm3(m.x), mm3(m.y)];
                    out.points.push(p);
                    match nearest_on(p, below) {
                        Some((q, dist)) if dist < spiral.max_xy_smoothing => {
                            let target = [q[0] * (1.0 - factor) + p[0] * factor, q[1] * (1.0 - factor) + p[1] * factor];
                            let moved = (target[0] - last_point[0]).hyp(target[1] - last_point[1]);
                            if moved < min_segment {
                                continue;
                            }
                            line.x = target[0];
                            line.y = target[1];
                            line.e = e5(line.e * moved / d);
                            line.form |= FORM_E;
                            last_point = target;
                        }
                        _ => last_point = p,
                    }
                } else if spiral.smooth {
                    out.points.push([mm3(m.x), mm3(m.y)]);
                }
                z_now = line.z;
                out.moves.push(line);
            }
            // Travels (with or without a new height) go, and the undoing of a retraction: Orca's spiral skips them.
            _ => {}
        }
    }
    out.at.push(out.moves.len());
    again_at.push(again.len());
    if ramp_out && !again.is_empty() {
        let start = out.moves.len();
        for m in &mut again {
            m.z = z_now;
            m.form &= !FORM_Z;
        }
        out.moves.extend(again);
        out.again = Some((start, again_at.iter().map(|k| start + k).collect()));
    }
    out
}

/// The point of the polyline `points` nearest `p`, with its distance (Orca's `nearest_point_on_lines`).
fn nearest_on(p: [f64; 2], points: &[[f64; 2]]) -> Option<([f64; 2], f64)> {
    if points.len() < 2 {
        return None;
    }
    // Orca works these out in single precision.
    let p = [p[0] as f32, p[1] as f32];
    let mut best: Option<([f64; 2], f32)> = None;
    for w in points.windows(2) {
        let (a, b) = ([w[0][0] as f32, w[0][1] as f32], [w[1][0] as f32, w[1][1] as f32]);
        let ab = [b[0] - a[0], b[1] - a[1]];
        let ca = [p[0] - a[0], p[1] - a[1]];
        let t = ((ca[0] * ab[0] + ca[1] * ab[1]) / (ab[0] * ab[0] + ab[1] * ab[1])).clamp(0.0, 1.0);
        let t = if t.is_nan() { 0.0 } else { t };
        let q = [a[0] + ab[0] * t, a[1] + ab[1] * t];
        let d = ((p[0] - q[0]).powi(2) + (p[1] - q[1]).powi(2)).sqrt();
        if best.is_none_or(|(_, bd)| d < bd) {
            best = Some(([q[0] as f64, q[1] as f64], d));
        }
    }
    best.map(|(q, d)| (q, d as f64))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mv(x: f64, y: f64, z: f64, e: f64, kind: Kind) -> Move {
        Move { x, y, z, e, f: 100.0, accel: f64::NAN, kind, width: 0.42, height: 0.2, form: 0, arc: None }
    }

    /// A square loop 10 mm a side at z 1.0, reached by a lift up from the layer below (0.8), a retraction, a lift,
    /// a travel and a lowering.
    fn layer() -> Vec<Move> {
        let ex = Kind::Extrude(Role::OuterWall);
        vec![
            mv(0.0, 0.0, 1.0, 0.0, Kind::Lift),
            mv(0.0, 0.0, 1.0, -0.4, Kind::Retract),
            mv(0.0, 0.0, 1.4, 0.0, Kind::Lift),
            mv(5.0, 0.0, 1.4, 0.0, Kind::Travel),
            mv(5.0, 0.0, 1.0, 0.0, Kind::Lift),
            mv(5.0, 0.0, 1.0, 0.4, Kind::Retract),
            mv(15.0, 0.0, 1.0, 0.4, ex),
            mv(15.0, 10.0, 1.0, 0.4, ex),
            mv(5.0, 10.0, 1.0, 0.4, ex),
            mv(5.0, 0.0, 1.0, 0.4, ex),
        ]
    }

    #[test]
    fn a_loop_climbs_a_layer_as_it_goes_round_and_its_travels_go() {
        let s = Settings::default();
        let course = Course { from: [0.0, 0.0, 0.8], ..Course::default() };
        let r = rise(&layer(), &course, &s);
        // The layer change and the lowering stay, at the height the layer starts from; the rest go but the loop.
        let kinds: Vec<Kind> = r.moves.iter().map(|m| m.kind).collect();
        assert_eq!(kinds[..3], [Kind::Lift, Kind::Lift, Kind::Lift]);
        assert!(r.moves[..3].iter().all(|m| (m.z - 0.8).abs() < 1e-9));
        let loop_z: Vec<f64> = r.moves[3..].iter().map(|m| m.z).collect();
        assert_eq!(loop_z, [0.85, 0.9, 0.95, 1.0]);
        // Where notes go: before the loop's first move for anything said before the deretraction.
        assert_eq!(r.at[6], 3);
        assert!(r.again.is_none());
    }

    #[test]
    fn the_first_turn_ramps_its_flow_up_and_the_last_runs_round_again_ramping_it_down() {
        let s = Settings::default();
        let first = rise(&layer(), &Course { from: [0.0, 0.0, 0.8], first: true, ..Course::default() }, &s);
        let e: Vec<f64> = first.moves[3..].iter().map(|m| m.e).collect();
        assert_eq!(e, [0.1, 0.2, 0.3, 0.4]);
        let last = rise(&layer(), &Course { from: [0.0, 0.0, 0.8], last: true, ..Course::default() }, &s);
        let (start, _) = last.again.clone().unwrap();
        assert_eq!(start, 7);
        let again: Vec<(f64, f64)> = last.moves[start..].iter().map(|m| (m.e, m.z)).collect();
        assert_eq!(again, [(0.3, 1.0), (0.2, 1.0), (0.1, 1.0), (0.0, 1.0)]);
    }

    #[test]
    fn layers_follow_orcas_rules() {
        let s =
            Settings { spiral_mode: true, bottom_shell_layers: 3, bottom_shell_thickness: 0.0, ..Settings::default() };
        let layers = Layers::plan(10.0, 0.2, 0.2);
        assert_eq!(first_layer(&layers, &s), 3);
        let thick = Settings { bottom_shell_thickness: 1.0, ..s.clone() };
        // Layers are cut halfway up (0.1, 0.3 … 0.9, 1.1 mm): the first cut at 1 mm or more is the sixth layer's.
        assert_eq!(first_layer(&layers, &thick), 5);
        assert!(!largest_wall(2, 0.6, &s) && largest_wall(3, 0.8, &s));
        let square =
            |d: i32| -> Shapes { vec![vec![vec![geom::pt(0, 0), geom::pt(d, 0), geom::pt(d, d), geom::pt(0, d)]]] };
        let slices: Vec<Shapes> = (0..6).map(|_| square(1000)).collect();
        let mut tops: Vec<Shapes> = (0..6).map(|_| Vec::new()).collect();
        let mut bottoms: Vec<Shapes> = (0..6).map(|i| if i == 0 { square(1000) } else { Vec::new() }).collect();
        tops[5] = square(1000);
        surfaces(&mut tops, &mut bottoms, &slices, &s);
        assert_eq!(bottoms.iter().map(Vec::len).collect::<Vec<_>>(), [1, 0, 0, 0, 0, 0]);
        assert_eq!(tops.iter().map(Vec::len).collect::<Vec<_>>(), [0, 0, 1, 0, 0, 0]);
    }
}
