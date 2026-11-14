//! 2D geometry in scaled integers: a point is 0.1 µm (`SCALE` units a millimetre), so a 256 mm plate fits easily in
//! i32 and boolean operations and offsets are exact. The polygon engine is `i_overlay` (pure Rust, so the same code
//! builds for WebAssembly). Shapes are an outer contour (counter-clockwise) followed by its holes (clockwise).

use i_overlay::core::extract::BooleanExtractionBuffer;
use i_overlay::core::fill_rule::FillRule;
use i_overlay::core::overlay::{IntOverlayOptions, Overlay};
use i_overlay::core::overlay_rule::OverlayRule;
use i_overlay::core::simplify::Simplify;
use i_overlay::core::single::SingleIntOverlay;
use i_overlay::i_float::int::point::IntPoint;
use i_overlay::mesh::int::arc::ArcOptions;
use i_overlay::mesh::int::outline::offset::IntOutlineOffset;
use i_overlay::mesh::int::style::{IntLineJoin, IntOutlineStyle};

pub type Pt = IntPoint<i32>;
pub type Contour = Vec<Pt>;
pub type Shape = Vec<Contour>;
pub type Shapes = Vec<Shape>;

/// Units in a millimetre.
pub const SCALE: f64 = 10_000.0;

#[inline]
pub fn sc(mm: f64) -> i32 {
    (mm * SCALE).round() as i32
}

#[inline]
pub fn unsc(v: i32) -> f64 {
    v as f64 / SCALE
}

#[inline]
pub fn pt(x: i32, y: i32) -> Pt {
    IntPoint::new(x, y)
}

fn options() -> IntOverlayOptions<u64> {
    IntOverlayOptions::default()
}

/// The region the contours enclose, counting each counter-clockwise loop +1 and each clockwise loop −1 (a slice's
/// outlines: outer walls one way, holes the other), as clean shapes.
pub fn union_contours(contours: &[Contour]) -> Shapes {
    if contours.is_empty() {
        return Vec::new();
    }
    contours.simplify(FillRule::Positive, options())
}

/// The region the contours enclose, counting every point any loop winds round (Orca's NonZero fill): a loop that
/// crosses itself keeps both its lobes.
pub fn union_nonzero(contours: &[Contour]) -> Shapes {
    if contours.is_empty() {
        return Vec::new();
    }
    contours.simplify(FillRule::NonZero, options())
}

pub fn union(a: &Shapes, b: &Shapes) -> Shapes {
    if a.is_empty() {
        return b.clone();
    }
    if b.is_empty() {
        return a.clone();
    }
    a.overlay(b, OverlayRule::Union, FillRule::Positive)
}

/// The union of many shape sets at once.
pub fn union_all(sets: &[&Shapes]) -> Shapes {
    let contours: Vec<Contour> = sets.iter().flat_map(|s| s.iter().flat_map(|shape| shape.iter().cloned())).collect();
    union_contours(&contours)
}

pub fn difference(a: &Shapes, b: &Shapes) -> Shapes {
    if a.is_empty() || b.is_empty() {
        return a.clone();
    }
    a.overlay(b, OverlayRule::Difference, FillRule::Positive)
}

/// `a − b` and `b − a` from one overlay (half the work of two differences).
pub fn differences(a: &Shapes, b: &Shapes) -> (Shapes, Shapes) {
    if a.is_empty() || b.is_empty() {
        return (a.clone(), b.clone());
    }
    let mut overlay = Overlay::from_subj_and_clip(a, b);
    let Some(graph) = overlay.build_graph_view(FillRule::Positive) else { return (Vec::new(), Vec::new()) };
    let mut buffer = BooleanExtractionBuffer::default();
    let a_only = graph.extract_shapes(OverlayRule::Difference, &mut buffer);
    let b_only = graph.extract_shapes(OverlayRule::InverseDifference, &mut buffer);
    (a_only, b_only)
}

pub fn intersection(a: &Shapes, b: &Shapes) -> Shapes {
    if a.is_empty() || b.is_empty() {
        return Vec::new();
    }
    a.overlay(b, OverlayRule::Intersect, FillRule::Positive)
}

/// Grows (positive) or shrinks (negative) shapes by `delta` mm, with mitred corners clipped at sharp angles (as
/// slicers offset walls).
pub fn offset(shapes: &Shapes, delta: f64) -> Shapes {
    offset_mitred(shapes, delta, 0.6)
}

/// `offset` with corners sharper than `min_angle` (radians) bevelled instead of mitred. Clipper's default miter
/// limit of 3, which Orca uses, mitres corners down to 2·asin(1/3) ≈ 0.68 rad.
pub fn offset_mitred(shapes: &Shapes, delta: f64, min_angle: f64) -> Shapes {
    let d = sc(delta);
    if shapes.is_empty() {
        return Vec::new();
    }
    if d == 0 {
        return shapes.clone();
    }
    let join = match i_overlay::i_float::int::angle::Angle::from_radians(min_angle) {
        Some(angle) => IntLineJoin::Miter(angle),
        None => IntLineJoin::Bevel,
    };
    let style = IntOutlineStyle::new(d).line_join(join);
    shapes.outline(&style).unwrap_or_default()
}

/// `offset` with round corners, each arc within `tolerance` mm of the circle: Clipper's round joins with that arc
/// tolerance (at most a quarter of the offset, as Clipper caps it).
pub fn offset_round(shapes: &Shapes, delta: f64, tolerance: f64) -> Shapes {
    let d = sc(delta);
    if shapes.is_empty() {
        return Vec::new();
    }
    if d == 0 {
        return shapes.clone();
    }
    let r = delta.abs();
    let y = tolerance.min(r * 0.25);
    let step = 2.0 * (1.0 - y / r).acos();
    let max_step = i_overlay::i_float::int::angle::Angle::from_radians(step).unwrap_or(ArcOptions::MAX_STEP);
    let join = IntLineJoin::Round(ArcOptions { max_step, rotation_precision: 5 });
    shapes.outline(&IntOutlineStyle::new(d).line_join(join)).unwrap_or_default()
}

/// `offset` with every corner bevelled: what Clipper's round joins come to at the coarse arc tolerance Orca grows
/// regions with (a turn under about 120° gets a single chord).
pub fn offset_bevel(shapes: &Shapes, delta: f64) -> Shapes {
    let d = sc(delta);
    if shapes.is_empty() || d == 0 {
        return shapes.clone();
    }
    shapes.outline(&IntOutlineStyle::new(d).line_join(IntLineJoin::Bevel)).unwrap_or_default()
}

/// Grows (positive) or shrinks (negative) shapes by `delta` mm with Clipper's square joins, as Orca's `jtSquare`: a
/// corner the offset goes round is cut off square `delta` from it (a right angle's by a 45° chamfer), and the
/// corners it goes into stay sharp. Clipper's `ClipperOffset` step by step: each edge moved along its normal, two
/// points at each corner it goes round, the corner itself between the ends of the edges at the others, and what
/// the paths wind round positively kept.
pub fn offset_square(shapes: &Shapes, delta: f64) -> Shapes {
    let d = delta * SCALE;
    if shapes.is_empty() {
        return Vec::new();
    }
    if d.abs() < 0.5 {
        return shapes.clone();
    }
    let at = |x: f64, y: f64| pt(x.round() as i32, y.round() as i32);
    let mut paths: Vec<Contour> = Vec::new();
    for contour in shapes.iter().flatten() {
        let mut src: Vec<Pt> = Vec::with_capacity(contour.len());
        for &q in contour {
            if src.last() != Some(&q) {
                src.push(q);
            }
        }
        while src.len() > 1 && src.first() == src.last() {
            src.pop();
        }
        if src.len() < 3 {
            continue;
        }
        let n = src.len();
        let normals: Vec<(f64, f64)> = (0..n)
            .map(|j| {
                let (a, b) = (src[j], src[(j + 1) % n]);
                let (dx, dy) = ((b.x - a.x) as f64, (b.y - a.y) as f64);
                let f = 1.0 / dx.hypot(dy);
                (dy * f, -dx * f)
            })
            .collect();
        let mut out = Vec::with_capacity(2 * n);
        let mut k = n - 1;
        for j in 0..n {
            let ((kx, ky), (jx, jy)) = (normals[k], normals[j]);
            let (x, y) = (src[j].x as f64, src[j].y as f64);
            let mut sin_a = kx * jy - jx * ky;
            let cos_a = kx * jx + ky * jy;
            if (sin_a * d).abs() < 1.0 {
                // Nearly straight on: one point (and Clipper keeps measuring from the edge before).
                if cos_a > 0.0 {
                    out.push(at(x + kx * d, y + ky * d));
                    continue;
                }
            } else {
                sin_a = sin_a.clamp(-1.0, 1.0);
            }
            if sin_a * d < 0.0 {
                out.push(at(x + kx * d, y + ky * d));
                out.push(src[j]);
                out.push(at(x + jx * d, y + jy * d));
            } else {
                let t = (sin_a.atan2(cos_a) / 4.0).tan();
                out.push(at(x + d * (kx - ky * t), y + d * (ky + kx * t)));
                out.push(at(x + d * (jx + jy * t), y + d * (jy - jx * t)));
            }
            k = j;
        }
        paths.push(out);
    }
    union_contours(&paths)
}

/// How `offset_c2` joins the edges at a corner it goes round: Clipper2's join kinds as Orca's wrappers set them up
/// (`c2_offset_setup`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Join {
    /// `jtSquare`: cut off square `delta` from the corner.
    Square,
    /// `jtMiter` with this limit, which Orca raises to at least 2: mitred where the mitre stays within the limit,
    /// squared beyond.
    Miter(f64),
    /// `jtRound` with this arc tolerance (mm), which Orca caps at a quarter of the offset.
    Round(f64),
}

/// Grows (positive) or shrinks (negative) shapes by `delta` mm as Orca 2.5 offsets them: Clipper2's `ClipperOffset`
/// on closed paths, ported with Orca's changes to it, its points to 0.1 µm. Points closer than a two-hundredth of the
/// offset to the last one kept go first (`append_offset_path`); each edge moves along its normal; a corner the
/// offset goes into gets the crossing of its edges where both are long enough (Orca's `OffsetConcaveCrossing`), else
/// three points whose loop the union takes out; a corner it goes round is mitred, squared or rounded by `join`; and
/// what the paths wind round positively is kept.
pub fn offset_c2(shapes: &Shapes, delta: f64, join: Join) -> Shapes {
    offset_c2_resolved(shapes, delta, join, false)
}

/// `offset_c2` for one shape shrunk past many small round features (a tree's branches, tens of times as wide as the
/// offset's step round them), several times faster: where its path folds back over itself at more than
/// `FOLDS_IN_PIECES` corners, the folds are resolved a stretch at a time. What it keeps is the same, but for points up
/// to a micrometre off where stretches cross, specks under 10 µm² left out.
pub fn offset_c2_folded(shapes: &Shapes, delta: f64, join: Join) -> Shapes {
    offset_c2_resolved(shapes, delta, join, true)
}

/// `offset_c2`, its folded paths resolved a stretch at a time where they fold often (`in_pieces`), or all at once.
fn offset_c2_resolved(shapes: &Shapes, delta: f64, join: Join, in_pieces: bool) -> Shapes {
    let d = delta * SCALE;
    if shapes.is_empty() {
        return Vec::new();
    }
    if d.abs() < 0.5 {
        return shapes.clone();
    }
    let abs_d = d.abs();
    let shortest2 = (abs_d * 0.005) * (abs_d * 0.005);
    // Mitred while the corner turns less than the limit allows (`temp_lim_`), and the round joins' fixed step.
    let miter_lim = match join {
        Join::Miter(limit) => 2.0 / limit.max(2.0).powi(2),
        _ => 2.0,
    };
    let (step_sin, step_cos, steps_per_rad) = match join {
        Join::Round(tolerance) => {
            let tol = (tolerance * SCALE).min(abs_d * 0.25);
            let arc_tol = if tol > 1e-12 { tol.min(abs_d) } else { abs_d * 0.002 };
            let steps_per_360 =
                (std::f64::consts::PI / (1.0 - arc_tol / abs_d).acos()).min(abs_d * std::f64::consts::PI);
            let angle = 2.0 * std::f64::consts::PI / steps_per_360;
            let s = if d < 0.0 { -angle.sin() } else { angle.sin() };
            (s, angle.cos(), steps_per_360 / (2.0 * std::f64::consts::PI))
        }
        _ => (0.0, 1.0, 0.0),
    };
    let at = |x: f64, y: f64| pt(x.round() as i32, y.round() as i32);
    let mut paths: Vec<Contour> = Vec::new();
    // Each contour's points as offset, and where its path folds back through a corner (the three points' middle):
    // at the path's index, the corner's.
    let mut kept: Vec<Contour> = Vec::new();
    let mut folds: Vec<Vec<(usize, usize)>> = Vec::new();
    for contour in shapes.iter().flatten() {
        let close = |a: &Pt, b: &Pt| {
            let (dx, dy) = ((a.x - b.x) as f64, (a.y - b.y) as f64);
            dx * dx + dy * dy < shortest2
        };
        let mut p: Vec<Pt> = Vec::with_capacity(contour.len());
        for q in contour {
            if p.last().is_none_or(|l| !close(q, l)) {
                p.push(*q);
            }
        }
        while p.len() > 1 && close(&p[p.len() - 1], &p[0]) {
            p.pop();
        }
        if p.len() < 3 || (d < 0.0 && area2(&p) == 0) {
            continue;
        }
        let n = p.len();
        let norms: Vec<(f64, f64)> = (0..n)
            .map(|i| {
                let (a, b) = (p[i], p[(i + 1) % n]);
                if a == b {
                    return (0.0, 0.0);
                }
                let (dx, dy) = ((b.x - a.x) as f64, (b.y - a.y) as f64);
                let f = 1.0 / (dx * dx + dy * dy).sqrt();
                (dy * f, -dx * f)
            })
            .collect();
        let mut out: Vec<Pt> = Vec::with_capacity(2 * n);
        let mut fold: Vec<(usize, usize)> = Vec::new();
        let mut k = n - 1;
        for j in 0..n {
            let (pj, pk) = (p[j], p[k]);
            if pj != pk {
                let (nj, nk) = (norms[j], norms[k]);
                let sin_a = (nj.1 * nk.0 - nk.1 * nj.0).clamp(-1.0, 1.0);
                let cos_a = nj.0 * nk.0 + nj.1 * nk.1;
                let (x, y) = (pj.x as f64, pj.y as f64);
                let concave = cos_a > -0.999 && sin_a * d < 0.0;
                // Orca's crossing for a corner the offset goes into, where neither edge is too short for it.
                let crossing = concave && {
                    let e = (d * sin_a).abs() / (1.0 + cos_a);
                    let next = p[(j + 1) % n];
                    let d2 = |a: Pt, b: Pt| ((a.x - b.x) as f64).powi(2) + ((a.y - b.y) as f64).powi(2);
                    4.0 * e * e <= d2(pk, pj) && 4.0 * e * e <= d2(pj, next)
                };
                if crossing {
                    let q = d / (1.0 + cos_a);
                    out.push(at(x + (nk.0 + nj.0) * q, y + (nk.1 + nj.1) * q));
                } else if concave {
                    out.push(at(x + nk.0 * d, y + nk.1 * d));
                    fold.push((out.len(), j));
                    out.push(pj);
                    out.push(at(x + nj.0 * d, y + nj.1 * d));
                } else if (cos_a > 0.999 && !matches!(join, Join::Round(_)))
                    || (matches!(join, Join::Miter(_)) && cos_a > miter_lim - 1.0)
                {
                    let q = d / (cos_a + 1.0);
                    out.push(at(x + (nk.0 + nj.0) * q, y + (nk.1 + nj.1) * q));
                } else if matches!(join, Join::Round(_)) {
                    let (mut vx, mut vy) = (nk.0 * d, nk.1 * d);
                    out.push(at(x + vx, y + vy));
                    let steps = ((steps_per_rad * sin_a.atan2(cos_a).abs()).round() as i64).max(1);
                    for _ in 1..steps {
                        (vx, vy) = (vx * step_cos - step_sin * vy, vx * step_sin + vy * step_cos);
                        out.push(at(x + vx, y + vy));
                    }
                    out.push(at(x + nj.0 * d, y + nj.1 * d));
                } else {
                    // Squared off `|d|` out from the corner (`DoSquare`).
                    let (ax, ay) = (nj.1 - nk.1, nk.0 - nj.0);
                    let h = (ax * ax + ay * ay).sqrt();
                    let v = if h < 0.001 { (0.0, 0.0) } else { (ax / h, ay / h) };
                    let q = (x + abs_d * v.0, y + abs_d * v.1);
                    let p1 = (q.0 + d * v.1, q.1 - d * v.0);
                    let p2 = (q.0 - d * v.1, q.1 + d * v.0);
                    let p3 = (pk.x as f64 + nk.0 * d, pk.y as f64 + nk.1 * d);
                    let p4 = (x + nk.0 * d, y + nk.1 * d);
                    let (dx1, dy1, dx2, dy2) = (p2.0 - p1.0, p2.1 - p1.1, p4.0 - p3.0, p4.1 - p3.1);
                    let det = dy1 * dx2 - dy2 * dx1;
                    let ip = if det == 0.0 {
                        q
                    } else {
                        let t = ((p1.0 - p3.0) * dy2 - (p1.1 - p3.1) * dx2) / det;
                        if t <= 0.0 {
                            p1
                        } else if t >= 1.0 {
                            p2
                        } else {
                            (p1.0 + t * dx1, p1.1 + t * dy1)
                        }
                    };
                    out.push(at(ip.0, ip.1));
                    out.push(at(q.0 + (q.0 - ip.0), q.1 + (q.1 - ip.1)));
                }
            }
            k = j;
        }
        paths.push(out);
        kept.push(p);
        folds.push(fold);
    }
    // A shape shrunk past many corners folds its path back over itself at each, tens of times over where it shrinks
    // past small round features (a tree's branches), and resolving all those crossings in one union is slow. Each
    // stretch of path between two of its folds, closed by the outline back to where it started, winds −1 round what
    // its edges and corners take out and nowhere else positively, and the whole path is those stretches and the
    // outline: so what it keeps is the shape less what the stretches take out, each resolved on its own.
    let fold_count: usize = folds.iter().map(Vec::len).sum();
    if in_pieces && d < 0.0 && shapes.len() == 1 && fold_count >= FOLDS_IN_PIECES {
        return shrunk_in_pieces(&kept, &paths, &folds);
    }
    union_contours(&paths)
}

/// Folds past which `offset_c2` resolves a shrunk shape's path a stretch at a time, and how many folds a stretch spans.
const FOLDS_IN_PIECES: usize = 16;
const FOLDS_A_PIECE: usize = 4;

/// What one shape's shrunk paths keep (see `offset_c2`): its outline (`kept`, each contour as offset) less what each
/// stretch of the paths between folds (`folds`: index in the path, corner) takes out.
fn shrunk_in_pieces(kept: &[Contour], paths: &[Contour], folds: &[Vec<(usize, usize)>]) -> Shapes {
    let mut pieces: Vec<Contour> = Vec::new();
    for ((p, out), fold) in kept.iter().zip(paths).zip(folds) {
        let n = p.len();
        if fold.len() < 2 {
            // Too few folds to cut at: the path with its outline turned back, which winds the same.
            let taken = vec![out.clone(), p.iter().rev().copied().collect()].simplify(FillRule::Negative, options());
            pieces.extend(taken.into_iter().flatten());
            continue;
        }
        let m = fold.len();
        let starts: Vec<usize> = (0..m).step_by(FOLDS_A_PIECE).collect();
        for (t, &a) in starts.iter().enumerate() {
            let b = starts.get(t + 1).copied().unwrap_or(m);
            let (from, corner_from) = fold[a];
            let (to, corner_to) = fold[b % m];
            // The path from one fold's corner to the other's, then the outline back.
            let mut piece: Contour =
                if b < m { out[from..=to].to_vec() } else { out[from..].iter().chain(&out[..=to]).copied().collect() };
            let mut c = (corner_to + n - 1) % n;
            while c != corner_from {
                piece.push(p[c]);
                c = (c + n - 1) % n;
            }
            let taken = [piece].simplify(FillRule::Negative, options());
            pieces.extend(taken.into_iter().flatten());
        }
    }
    if pieces.is_empty() {
        return union_contours(kept);
    }
    // The outline less every piece's area at once: each piece turned round winds −1 where it takes out.
    let mut all: Vec<Contour> = kept.to_vec();
    all.extend(pieces.into_iter().map(|mut c| {
        c.reverse();
        c
    }));
    let mut out = union_contours(&all);
    // Where pieces cross, their points rounded to our grid can leave specks of a few square micrometres, or holes as
    // small, that one union of the whole path doesn't. A speck stays only if the whole path winds round its middle,
    // a hole only if it doesn't.
    let speck = |c: &Contour| area2(c).unsigned_abs() < 2 * SPECK_AREA;
    let kept_by_path = |c: &Contour| winding(paths, centre(c)) > 0;
    out.retain(|shape| !speck(&shape[0]) || kept_by_path(&shape[0]));
    for shape in &mut out {
        let mut k = 1;
        while k < shape.len() {
            if speck(&shape[k]) && kept_by_path(&shape[k]) {
                shape.remove(k);
            } else {
                k += 1;
            }
        }
    }
    out
}

/// 0.01 µm²: the area under which `offset_c2_folded` checks a shape or hole against the whole path, 10 µm².
const SPECK_AREA: u128 = 1000;

/// A contour's centroid, unrounded, or its first point where it has no area.
fn centre(c: &Contour) -> (f64, f64) {
    let (mut a, mut x, mut y) = (0.0, 0.0, 0.0);
    for i in 0..c.len() {
        let (p, q) = (c[i], c[(i + 1) % c.len()]);
        let cross = p.x as f64 * q.y as f64 - q.x as f64 * p.y as f64;
        a += cross;
        x += (p.x + q.x) as f64 * cross;
        y += (p.y + q.y) as f64 * cross;
    }
    if a == 0.0 { (c[0].x as f64, c[0].y as f64) } else { (x / (3.0 * a), y / (3.0 * a)) }
}

/// How many times closed paths wind round a point (anticlockwise counts up).
fn winding(paths: &[Contour], (x, y): (f64, f64)) -> i32 {
    let mut w = 0;
    for c in paths {
        for i in 0..c.len() {
            let (a, b) = (c[i], c[(i + 1) % c.len()]);
            let (ay, by) = (a.y as f64, b.y as f64);
            let side = (b.x - a.x) as f64 * (y - ay) - (x - a.x as f64) * (by - ay);
            if ay <= y && by > y && side > 0.0 {
                w += 1;
            } else if by <= y && ay > y && side < 0.0 {
                w -= 1;
            }
        }
    }
    w
}

/// What an open path covers grown `delta` mm to both sides, with square joins and flat ends: Clipper2's offset of an
/// open path (`ClipperOffset::OffsetOpenPath`, `EndType::Butt`, `JoinType::Square`), which Orca 2.5's
/// `offset(Polyline, delta)` makes, its loops resolved with positive fill. A path that ends where it starts covers
/// the whole ring.
pub fn offset_open(points: &[Pt], delta: f64) -> Shapes {
    let d = (delta * SCALE).abs();
    if d < 0.5 || points.is_empty() {
        return Vec::new();
    }
    // A point closer than Clipper's shortest edge to the last one kept goes (Orca's `append_offset_path`).
    let shortest2 = (d * 0.005) * (d * 0.005);
    let mut p: Vec<Pt> = Vec::with_capacity(points.len());
    for &q in points {
        let close = p.last().is_some_and(|l: &Pt| {
            let (dx, dy) = ((q.x - l.x) as f64, (q.y - l.y) as f64);
            dx * dx + dy * dy < shortest2
        });
        if !close {
            p.push(q);
        }
    }
    let at = |x: f64, y: f64| pt(x.round() as i32, y.round() as i32);
    let n = p.len();
    if n == 1 {
        if d < 1.0 {
            return Vec::new();
        }
        let r = d.ceil() as i32;
        let (x, y) = (p[0].x, p[0].y);
        return union_contours(&[vec![pt(x - r, y - r), pt(x + r, y - r), pt(x + r, y + r), pt(x - r, y + r)]]);
    }
    let unit_normal = |a: Pt, b: Pt| -> (f64, f64) {
        if a == b {
            return (0.0, 0.0);
        }
        let (dx, dy) = ((b.x - a.x) as f64, (b.y - a.y) as f64);
        let f = 1.0 / (dx * dx + dy * dy).sqrt();
        (dy * f, -dx * f)
    };
    let mut norms: Vec<(f64, f64)> = (0..n).map(|i| unit_normal(p[i], p[(i + 1) % n])).collect();
    let mut out: Vec<Pt> = Vec::with_capacity(4 * n);
    // Clipper2's `OffsetPoint` with square joins: the corner at `j`, coming from `k`.
    let offset_point = |out: &mut Vec<Pt>, norms: &[(f64, f64)], j: usize, k: usize| {
        if p[j] == p[k] {
            return;
        }
        let (nj, nk) = (norms[j], norms[k]);
        let sin_a = (nj.1 * nk.0 - nk.1 * nj.0).clamp(-1.0, 1.0);
        let cos_a = nj.0 * nk.0 + nj.1 * nk.1;
        let (x, y) = (p[j].x as f64, p[j].y as f64);
        if cos_a > -0.999 && sin_a * d < 0.0 {
            // Concave: three points, whose loop the union takes out.
            out.push(at(x + nk.0 * d, y + nk.1 * d));
            out.push(p[j]);
            out.push(at(x + nj.0 * d, y + nj.1 * d));
        } else if cos_a > 0.999 {
            // Nearly straight on: a mitre.
            let q = d / (cos_a + 1.0);
            out.push(at(x + (nk.0 + nj.0) * q, y + (nk.1 + nj.1) * q));
        } else {
            // Squared off `d` out from the corner (`DoSquare`).
            let (ax, ay) = (nj.1 - nk.1, nk.0 - nj.0);
            let h = (ax * ax + ay * ay).sqrt();
            let v = if h < 0.001 { (0.0, 0.0) } else { (ax / h, ay / h) };
            let q = (x + d * v.0, y + d * v.1);
            let p1 = (q.0 + d * v.1, q.1 - d * v.0);
            let p2 = (q.0 - d * v.1, q.1 + d * v.0);
            let p3 = (p[k].x as f64 + nk.0 * d, p[k].y as f64 + nk.1 * d);
            let p4 = (x + nk.0 * d, y + nk.1 * d);
            let (dx1, dy1, dx2, dy2) = (p2.0 - p1.0, p2.1 - p1.1, p4.0 - p3.0, p4.1 - p3.1);
            let det = dy1 * dx2 - dy2 * dx1;
            let ip = if det == 0.0 {
                q
            } else {
                let t = ((p1.0 - p3.0) * dy2 - (p1.1 - p3.1) * dx2) / det;
                if t <= 0.0 {
                    p1
                } else if t >= 1.0 {
                    p2
                } else {
                    (p1.0 + t * dx1, p1.1 + t * dy1)
                }
            };
            out.push(at(ip.0, ip.1));
            out.push(at(q.0 + (q.0 - ip.0), q.1 + (q.1 - ip.1)));
        }
    };
    // The start's flat end, one side forward, the end's flat end, the other side back (counter-clockwise).
    let (x0, y0) = (p[0].x as f64, p[0].y as f64);
    out.push(at(x0 - d * norms[0].0, y0 - d * norms[0].1));
    out.push(at(x0 + d * norms[0].0, y0 + d * norms[0].1));
    let last = n - 1;
    for j in 1..last {
        offset_point(&mut out, &norms, j, j - 1);
    }
    for i in (1..=last).rev() {
        norms[i] = (-norms[i - 1].0, -norms[i - 1].1);
    }
    norms[0] = norms[last];
    let (xl, yl) = (p[last].x as f64, p[last].y as f64);
    out.push(at(xl - d * norms[last].0, yl - d * norms[last].1));
    out.push(at(xl + d * norms[last].0, yl + d * norms[last].1));
    for j in (1..last).rev() {
        offset_point(&mut out, &norms, j, j + 1);
    }
    union_contours(&[out])
}

/// Shrinks then grows back: drops every part thinner than `2 × d`.
pub fn opening(shapes: &Shapes, d: f64) -> Shapes {
    offset(&offset(shapes, -d), d)
}

/// Grows then shrinks back: closes every gap and notch narrower than `2 × d`.
pub fn closing(shapes: &Shapes, d: f64) -> Shapes {
    offset(&offset(shapes, d), -d)
}

/// Twice the signed area of a closed contour, in units² (positive when counter-clockwise).
pub fn area2(contour: &[Pt]) -> i128 {
    let n = contour.len();
    if n < 3 {
        return 0;
    }
    let mut sum: i128 = 0;
    let mut prev = contour[n - 1];
    for &p in contour {
        sum += prev.x as i128 * p.y as i128 - p.x as i128 * prev.y as i128;
        prev = p;
    }
    sum
}

/// The area of shapes, in mm² (holes subtracted).
pub fn area_mm2(shapes: &Shapes) -> f64 {
    let mut total: i128 = 0;
    for shape in shapes {
        for contour in shape {
            total += area2(contour);
        }
    }
    total as f64 / 2.0 / (SCALE * SCALE)
}

pub fn shape_area_mm2(shape: &Shape) -> f64 {
    shape.iter().map(|c| area2(c)).sum::<i128>() as f64 / 2.0 / (SCALE * SCALE)
}

/// Starts each loop of a boolean's result where Clipper2, Orca's polygon engine, starts it: right after the point
/// where its sweep (from the highest y down) closes the loop. That is the loop's lowest point; where the loop's
/// bottom is a level edge, the end of it the sweep runs to along the input edge it lies on (`inputs`, the boolean's
/// operands), which an input outline runs along forwards where it comes down to the edge or goes on down, and
/// backwards where it climbs both to and from it. Holes start after their lowest point, the rightmost of the lowest.
/// Orca spaces points along outlines from their start (the classic trees' contact points), so they land where Orca's
/// do. A guide, not Clipper2: loops whose bottom edge lies on edges of both operands may start elsewhere.
pub fn clipper2_start(result: &mut Shapes, inputs: &[&Shapes]) {
    for shape in result.iter_mut() {
        for l in shape.iter_mut() {
            let n = l.len();
            if n < 3 {
                continue;
            }
            let start = clipper2_start_of(l, area2(l) > 0, inputs);
            l.rotate_left(start % n);
        }
    }
}

fn clipper2_start_of(l: &[Pt], outer: bool, inputs: &[&Shapes]) -> usize {
    let n = l.len();
    let ymin = l.iter().map(|p| p.y).min().unwrap_or(0);
    let lowest_right = (0..n).filter(|&i| l[i].y == ymin).max_by_key(|&i| l[i].x).unwrap_or(0);
    let lowest_left = (0..n).filter(|&i| l[i].y == ymin).min_by_key(|&i| l[i].x).unwrap_or(0);
    if !outer || lowest_left == lowest_right {
        return lowest_right + 1;
    }
    let (cx, dx) = (l[lowest_left].x, l[lowest_right].x);
    // The input edge the bottom edge lies on, and which way the sweep runs along it.
    for c in inputs.iter().flat_map(|s| s.iter().flatten()) {
        let m = c.len();
        for i in 0..m {
            let (a, b) = (c[i], c[(i + 1) % m]);
            if a.y != ymin || b.y != ymin || a.x.max(b.x).min(dx) <= a.x.min(b.x).max(cx) {
                continue;
            }
            // The outline's way in to the edge and out of it, past any other level edges.
            let mut k = i;
            let mut steps = 0;
            while c[(k + m - 1) % m].y == ymin && steps < m {
                k = (k + m - 1) % m;
                steps += 1;
            }
            let before = ymin as i64 - c[(k + m - 1) % m].y as i64;
            let mut k = (i + 1) % m;
            let mut steps = 0;
            while c[(k + 1) % m].y == ymin && steps < m {
                k = (k + 1) % m;
                steps += 1;
            }
            let after = c[(k + 1) % m].y as i64 - ymin as i64;
            let forwards = if b.x > a.x { 1 } else { -1 };
            let way = match (before < 0, after > 0) {
                (true, _) => forwards,
                (false, true) => -forwards,
                (false, false) => 0,
            };
            return match way {
                // Swept leftwards: closed at its left end, so the loop starts at its right end.
                -1 => lowest_right,
                _ => lowest_right + 1,
            };
        }
    }
    lowest_right + 1
}

/// Drops points of a closed contour that lie within `tolerance` (units) of the line through their neighbours
/// (Ramer–Douglas–Peucker on the closed loop), keeping its shape to that tolerance.
pub fn simplify_contour(contour: &[Pt], tolerance: i32) -> Contour {
    let n = contour.len();
    if n <= 4 {
        return contour.to_vec();
    }
    // Split the loop at its first point and the point farthest from it, simplify both halves.
    let first = contour[0];
    let mut far = 0;
    let mut far_d: i128 = -1;
    for (i, p) in contour.iter().enumerate() {
        let dx = (p.x - first.x) as i128;
        let dy = (p.y - first.y) as i128;
        let d = dx * dx + dy * dy;
        if d > far_d {
            far_d = d;
            far = i;
        }
    }
    let tol2 = (tolerance as f64) * (tolerance as f64);
    let mut keep = vec![false; n];
    keep[0] = true;
    keep[far] = true;
    rdp(contour, 0, far, tol2, &mut keep);
    rdp_wrap(contour, far, n, tol2, &mut keep);
    let out: Contour = contour.iter().zip(keep).filter(|(_, k)| *k).map(|(p, _)| *p).collect();
    if out.len() < 3 { contour.to_vec() } else { out }
}

/// Every contour of the shapes simplified to `tolerance` mm (see `simplify_contour`); contours that collapse are
/// dropped.
pub fn simplify_shapes(shapes: &Shapes, tolerance: f64) -> Shapes {
    let tol = (tolerance * SCALE).round().max(1.0) as i32;
    shapes
        .iter()
        .filter_map(|shape| {
            let simplified: Shape = shape.iter().map(|c| simplify_contour(c, tol)).filter(|c| c.len() >= 3).collect();
            (!simplified.is_empty()).then_some(simplified)
        })
        .collect()
}

/// Orca's `polygons_simplify`: each contour simplified as a closed line (`simplify_line` from its first point round
/// to it again), those left with fewer than three points dropped, and the rest made clean shapes again.
pub fn simplify_polygons(shapes: &Shapes, tolerance: f64) -> Shapes {
    let mut contours: Vec<Contour> = Vec::new();
    for contour in shapes.iter().flatten() {
        if contour.len() < 3 {
            continue;
        }
        let mut closed = contour.clone();
        closed.push(contour[0]);
        let mut simplified = simplify_line(&closed, tolerance);
        simplified.pop();
        if simplified.len() >= 3 {
            contours.push(simplified);
        }
    }
    union_contours(&contours)
}

/// Orca's `make_circle`: a circle of `radius` mm round the origin whose chords stray at most `error` mm from it,
/// counter-clockwise from (radius, 0), its points truncated towards zero (0.1 µm units).
pub fn make_circle(radius: f64, error: f64) -> Contour {
    let r = radius * SCALE;
    let n = (2.0 * std::f64::consts::PI / (2.0 * (1.0 - error / radius).acos())).ceil().max(3.0) as usize;
    (0..n)
        .map(|i| {
            let a = 2.0 * std::f64::consts::PI * i as f64 / n as f64;
            pt((a.cos() * r) as i32, (a.sin() * r) as i32)
        })
        .collect()
}

/// An open line (or a loop that repeats its first point) with the points dropped that lie within `tolerance` mm of
/// the segment between the points kept around them, its ends kept: Orca's `_douglas_peucker`, which measures to the
/// segment, so a line that doubles back keeps its turn.
pub fn simplify_line(points: &[Pt], tolerance: f64) -> Vec<Pt> {
    let n = points.len();
    if n <= 2 || tolerance <= 0.0 {
        return points.to_vec();
    }
    let tol2 = (tolerance * SCALE).powi(2);
    let mut out = Vec::with_capacity(n);
    out.push(points[0]);
    let mut anchor = 0;
    let mut stack = vec![n - 1];
    while let Some(&floater) = stack.last() {
        let (a, b) = (points[anchor], points[floater]);
        let (mut far, mut far_d2) = (anchor, 0.0);
        for (k, &p) in points.iter().enumerate().take(floater).skip(anchor + 1) {
            let d2 = segment_dist2(p, a, b);
            if d2 > far_d2 {
                far = k;
                far_d2 = d2;
            }
        }
        if far_d2 <= tol2 {
            out.push(b);
            anchor = floater;
            stack.pop();
        } else {
            stack.push(far);
        }
    }
    out
}

/// Squared distance (units²) from p to the segment a–b.
pub(crate) fn segment_dist2(p: Pt, a: Pt, b: Pt) -> f64 {
    let (dx, dy) = ((b.x - a.x) as f64, (b.y - a.y) as f64);
    let (px, py) = ((p.x - a.x) as f64, (p.y - a.y) as f64);
    let len2 = dx * dx + dy * dy;
    let t = if len2 == 0.0 { 0.0 } else { ((px * dx + py * dy) / len2).clamp(0.0, 1.0) };
    let (ex, ey) = (px - t * dx, py - t * dy);
    ex * ex + ey * ey
}

fn rdp(points: &[Pt], from: usize, to: usize, tol2: f64, keep: &mut [bool]) {
    let mut stack = vec![(from, to)];
    while let Some((a, b)) = stack.pop() {
        if b <= a + 1 {
            continue;
        }
        let (i, d2) = farthest(points, a, b, |k| k);
        if d2 > tol2 {
            keep[i] = true;
            stack.push((a, i));
            stack.push((i, b));
        }
    }
}

/// The second half of the loop: from `from` round to the start (index `n` is point 0 again).
fn rdp_wrap(points: &[Pt], from: usize, n: usize, tol2: f64, keep: &mut [bool]) {
    let mut stack = vec![(from, n)];
    while let Some((a, b)) = stack.pop() {
        if b <= a + 1 {
            continue;
        }
        let (i, d2) = farthest(points, a, b, |k| k % n);
        if d2 > tol2 {
            keep[i % n] = true;
            stack.push((a, i));
            stack.push((i, b));
        }
    }
}

/// The point between a and b (exclusive) farthest from the chord a–b, and its squared distance.
#[inline]
fn farthest(points: &[Pt], a: usize, b: usize, at: impl Fn(usize) -> usize) -> (usize, f64) {
    let pa = points[at(a)];
    let pb = points[at(b)];
    let (ax, ay) = (pa.x as f64, pa.y as f64);
    let (dx, dy) = (pb.x as f64 - ax, pb.y as f64 - ay);
    let len2 = dx * dx + dy * dy;
    let mut best = (a, -1.0);
    for k in a + 1..b {
        let p = points[at(k)];
        let (px, py) = (p.x as f64 - ax, p.y as f64 - ay);
        let d2 = if len2 == 0.0 {
            px * px + py * py
        } else {
            let cross = px * dy - py * dx;
            cross * cross / len2
        };
        if d2 > best.1 {
            best = (k, d2);
        }
    }
    best
}

/// Whether a point is inside the shapes (non-zero winding over every contour, so holes count).
pub fn contains(shapes: &[Shape], p: Pt) -> bool {
    let mut winding = 0i32;
    for shape in shapes {
        for contour in shape {
            winding += winding_number(contour, p);
        }
    }
    winding != 0
}

/// Whether a point lies inside a contour, either way round.
pub fn contour_contains(contour: &[Pt], p: Pt) -> bool {
    winding_number(contour, p) != 0
}

/// A contour's centroid by area (Orca's `Polygon::centroid`, truncated to whole units as its point is).
pub fn centroid(contour: &[Pt]) -> Pt {
    let (mut area, mut cx, mut cy) = (0.0f64, 0.0f64, 0.0f64);
    if contour.len() >= 3 {
        let mut p1 = contour[contour.len() - 1];
        for &p2 in contour {
            let a = p1.x as f64 * p2.y as f64 - p2.x as f64 * p1.y as f64;
            area += a;
            cx += (p1.x as f64 + p2.x as f64) * a;
            cy += (p1.y as f64 + p2.y as f64) * a;
            p1 = p2;
        }
    }
    if area == 0.0 {
        return contour.first().copied().unwrap_or(pt(0, 0));
    }
    pt((cx / (3.0 * area)) as i32, (cy / (3.0 * area)) as i32)
}

fn winding_number(contour: &[Pt], p: Pt) -> i32 {
    let n = contour.len();
    let mut w = 0;
    for i in 0..n {
        let a = contour[i];
        let b = contour[(i + 1) % n];
        if a.y <= p.y {
            if b.y > p.y && cross(a, b, p) > 0 {
                w += 1;
            }
        } else if b.y <= p.y && cross(a, b, p) < 0 {
            w -= 1;
        }
    }
    w
}

/// Whether the segment a–b stays inside the shapes: `a` is inside and the segment crosses no contour.
pub fn segment_inside(shapes: &[Shape], a: Pt, b: Pt) -> bool {
    contains(shapes, a) && !segment_crosses(shapes, a, b)
}

/// Whether the segment a–b crosses or touches any of the shapes' contours.
pub fn segment_crosses(shapes: &[Shape], a: Pt, b: Pt) -> bool {
    shapes.iter().flatten().any(|contour| contour_crosses(contour, a, b))
}

/// Whether the segment a–b crosses or touches a contour.
pub fn contour_crosses(contour: &[Pt], a: Pt, b: Pt) -> bool {
    let (lo_x, hi_x) = (a.x.min(b.x), a.x.max(b.x));
    let (lo_y, hi_y) = (a.y.min(b.y), a.y.max(b.y));
    let n = contour.len();
    for i in 0..n {
        let (c, d) = (contour[i], contour[(i + 1) % n]);
        if c.x.max(d.x) < lo_x || c.x.min(d.x) > hi_x || c.y.max(d.y) < lo_y || c.y.min(d.y) > hi_y {
            continue;
        }
        if segments_cross(a, b, c, d) {
            return true;
        }
    }
    false
}

/// Whether two segments cross or touch.
fn segments_cross(a: Pt, b: Pt, c: Pt, d: Pt) -> bool {
    let d1 = cross(c, d, a).signum();
    let d2 = cross(c, d, b).signum();
    let d3 = cross(a, b, c).signum();
    let d4 = cross(a, b, d).signum();
    d1 * d2 <= 0 && d3 * d4 <= 0 && !(d1 == 0 && d2 == 0 && d3 == 0 && d4 == 0 && !overlap(a, b, c, d))
}

/// Collinear segments: whether their spans overlap.
fn overlap(a: Pt, b: Pt, c: Pt, d: Pt) -> bool {
    let span = |p: Pt, q: Pt| (p.x.min(q.x), p.x.max(q.x), p.y.min(q.y), p.y.max(q.y));
    let (ax0, ax1, ay0, ay1) = span(a, b);
    let (cx0, cx1, cy0, cy1) = span(c, d);
    ax0 <= cx1 && cx0 <= ax1 && ay0 <= cy1 && cy0 <= ay1
}

#[inline]
fn cross(a: Pt, b: Pt, p: Pt) -> i64 {
    (b.x as i64 - a.x as i64) * (p.y as i64 - a.y as i64) - (p.x as i64 - a.x as i64) * (b.y as i64 - a.y as i64)
}

/// Length of a polyline (closed when `closed`), in mm.
pub fn length_mm(points: &[Pt], closed: bool) -> f64 {
    let mut total = 0.0;
    for w in points.windows(2) {
        total += dist(w[0], w[1]);
    }
    if closed && points.len() > 1 {
        total += dist(points[points.len() - 1], points[0]);
    }
    total / SCALE
}

#[inline]
pub fn dist(a: Pt, b: Pt) -> f64 {
    let dx = (a.x - b.x) as f64;
    let dy = (a.y - b.y) as f64;
    (dx * dx + dy * dy).sqrt()
}

/// The shapes whose bounding box meets `bbox` (min x, min y, max x, max y): what a boolean with something inside
/// `bbox` can touch. With many islands on a layer, it keeps each island's booleans to its neighbourhood.
pub fn near(shapes: &Shapes, bbox: [i32; 4]) -> Shapes {
    shapes
        .iter()
        .filter(|shape| {
            shape.first().is_some_and(|outer| {
                let mut b = [i32::MAX, i32::MAX, i32::MIN, i32::MIN];
                for p in outer {
                    b[0] = b[0].min(p.x);
                    b[1] = b[1].min(p.y);
                    b[2] = b[2].max(p.x);
                    b[3] = b[3].max(p.y);
                }
                b[0] <= bbox[2] && bbox[0] <= b[2] && b[1] <= bbox[3] && bbox[1] <= b[3]
            })
        })
        .cloned()
        .collect()
}

/// The shapes as far as anything inside `bbox` can tell: those whose outline meets it, each with only the holes
/// that meet it. A boolean with something inside `bbox` gives the same with these as with the whole shapes, at the
/// cost of what is near (a layer's solid infill can have hundreds of holes).
pub fn local(shapes: &Shapes, bbox: [i32; 4]) -> Shapes {
    let meets = |c: &Contour| {
        let mut b = [i32::MAX, i32::MAX, i32::MIN, i32::MIN];
        for p in c {
            b[0] = b[0].min(p.x);
            b[1] = b[1].min(p.y);
            b[2] = b[2].max(p.x);
            b[3] = b[3].max(p.y);
        }
        b[0] <= bbox[2] && bbox[0] <= b[2] && b[1] <= bbox[3] && bbox[1] <= b[3]
    };
    shapes
        .iter()
        .filter(|shape| shape.first().is_some_and(meets))
        .map(|shape| {
            let mut out = vec![shape[0].clone()];
            out.extend(shape[1..].iter().filter(|hole| meets(hole)).cloned());
            out
        })
        .collect()
}

/// The shapes cut to a box, contour by contour (Sutherland–Hodgman, as Orca's
/// `clip_clipper_polygons_with_subject_bbox`): cheap, and exact inside the box, though a contour cut by it may run
/// along its edge both ways; fit only as an operand of a boolean that keeps to the box.
pub fn clip_box(shapes: &Shapes, b: [i32; 4]) -> Shapes {
    let clip = |contour: &Contour| -> Contour {
        let mut out: Vec<Pt> = contour.clone();
        // Each edge of the box: keep what is on its inner side.
        for side in 0..4 {
            if out.is_empty() {
                break;
            }
            let inside = |p: Pt| match side {
                0 => p.x >= b[0],
                1 => p.x <= b[2],
                2 => p.y >= b[1],
                _ => p.y <= b[3],
            };
            let cut = |p: Pt, q: Pt| -> Pt {
                let (px, py, qx, qy) = (p.x as f64, p.y as f64, q.x as f64, q.y as f64);
                match side {
                    0 | 1 => {
                        let x = if side == 0 { b[0] } else { b[2] } as f64;
                        pt(x as i32, (py + (qy - py) * (x - px) / (qx - px)).round() as i32)
                    }
                    _ => {
                        let y = if side == 2 { b[1] } else { b[3] } as f64;
                        pt((px + (qx - px) * (y - py) / (qy - py)).round() as i32, y as i32)
                    }
                }
            };
            let input = std::mem::take(&mut out);
            let n = input.len();
            for i in 0..n {
                let (p, q) = (input[(i + n - 1) % n], input[i]);
                match (inside(p), inside(q)) {
                    (true, true) => out.push(q),
                    (true, false) => out.push(cut(p, q)),
                    (false, true) => {
                        out.push(cut(p, q));
                        out.push(q);
                    }
                    (false, false) => {}
                }
            }
        }
        out
    };
    shapes
        .iter()
        .filter_map(|shape| {
            let outer = clip(shape.first()?);
            if outer.len() < 3 {
                return None;
            }
            let mut out = vec![outer];
            out.extend(shape[1..].iter().map(clip).filter(|c| c.len() >= 3));
            Some(out)
        })
        .collect()
}

/// A bounding box grown by `d` mm on every side.
pub fn inflate(b: [i32; 4], d: f64) -> [i32; 4] {
    let d = sc(d);
    [b[0].saturating_sub(d), b[1].saturating_sub(d), b[2].saturating_add(d), b[3].saturating_add(d)]
}

/// Bounding box of one shape's outer contour: min x, min y, max x, max y (units).
pub fn bbox_of(shape: &Shape) -> [i32; 4] {
    let mut b = [i32::MAX, i32::MAX, i32::MIN, i32::MIN];
    if let Some(outer) = shape.first() {
        for p in outer {
            b[0] = b[0].min(p.x);
            b[1] = b[1].min(p.y);
            b[2] = b[2].max(p.x);
            b[3] = b[3].max(p.y);
        }
    }
    b
}

/// Whether a point is inside one shape (its outline, not in its holes).
pub fn shape_contains(shape: &Shape, p: Pt) -> bool {
    shape.iter().map(|c| winding_number(c, p)).sum::<i32>() != 0
}

/// Bounding box of shapes: min x, min y, max x, max y (units).
pub fn bbox(shapes: &Shapes) -> Option<[i32; 4]> {
    let mut b = [i32::MAX, i32::MAX, i32::MIN, i32::MIN];
    let mut any = false;
    for shape in shapes {
        if let Some(outer) = shape.first() {
            for p in outer {
                any = true;
                b[0] = b[0].min(p.x);
                b[1] = b[1].min(p.y);
                b[2] = b[2].max(p.x);
                b[3] = b[3].max(p.y);
            }
        }
    }
    any.then_some(b)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mm(x: f64, y: f64) -> Pt {
        pt((x * SCALE).round() as i32, (y * SCALE).round() as i32)
    }

    #[test]
    fn a_line_keeps_its_ends_and_turns_and_drops_what_strays_less_than_the_tolerance() {
        // Points a hundredth of a millimetre off a straight line go; a corner stays.
        let line = [mm(0.0, 0.0), mm(1.0, 0.01), mm(2.0, -0.01), mm(3.0, 0.0), mm(3.0, 2.0), mm(3.005, 4.0)];
        assert_eq!(simplify_line(&line, 0.012), vec![mm(0.0, 0.0), mm(3.0, 0.0), mm(3.005, 4.0)]);
        // A loop that repeats its first point keeps both ends.
        let square = [mm(0.0, 0.0), mm(2.0, 0.0), mm(2.0, 2.0), mm(1.0, 2.001), mm(0.0, 2.0), mm(0.0, 0.0)];
        assert_eq!(
            simplify_line(&square, 0.012),
            vec![mm(0.0, 0.0), mm(2.0, 0.0), mm(2.0, 2.0), mm(0.0, 2.0), mm(0.0, 0.0)]
        );
    }

    #[test]
    fn a_shape_shrunk_past_many_folds_keeps_what_one_union_of_its_path_keeps() {
        // Blobs of small circles, as a tree's branches merge into: shrunk in stretches, they keep what resolving the
        // whole path at once keeps, the same shapes with their points within a micrometre.
        let mut seed: u64 = 7;
        let mut next = || {
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            (seed >> 33) as f64 / (1u64 << 31) as f64
        };
        let circle = |cx: f64, cy: f64, r: f64| -> Contour {
            (0..100)
                .map(|i| {
                    let a = i as f64 / 100.0 * std::f64::consts::TAU;
                    mm(cx + r * a.cos(), cy + r * a.sin())
                })
                .collect()
        };
        let mut checked = 0;
        for blob in 0..6 {
            let circles: Vec<Contour> =
                (0..20 + 20 * blob).map(|_| circle(next() * 12.0, next() * 25.0, 0.4 + next() * 1.6)).collect();
            for shape in union_contours(&circles) {
                let one = vec![shape];
                for (delta, join) in [
                    (-0.63, Join::Miter(3.0)),
                    (-0.42, Join::Miter(1.2)),
                    (-0.21, Join::Square),
                    (-0.5, Join::Round(0.0)),
                ] {
                    let pieces = offset_c2_resolved(&one, delta, join, true);
                    let whole = offset_c2_resolved(&one, delta, join, false);
                    assert_eq!(pieces.len(), whole.len(), "blob {blob}, {delta} {join:?}");
                    // Every point of each within a micrometre of the other's outline.
                    let off = |a: &Shapes, b: &Shapes| {
                        a.iter()
                            .flatten()
                            .flatten()
                            .map(|&p| {
                                b.iter()
                                    .flatten()
                                    .flat_map(|c| (0..c.len()).map(move |i| (c[i], c[(i + 1) % c.len()])))
                                    .map(|(u, v)| {
                                        let (dx, dy) = ((v.x - u.x) as f64, (v.y - u.y) as f64);
                                        let l2 = dx * dx + dy * dy;
                                        let t = if l2 == 0.0 {
                                            0.0
                                        } else {
                                            (((p.x - u.x) as f64 * dx + (p.y - u.y) as f64 * dy) / l2).clamp(0.0, 1.0)
                                        };
                                        ((p.x - u.x) as f64 - t * dx).hypot((p.y - u.y) as f64 - t * dy)
                                    })
                                    .fold(f64::MAX, f64::min)
                            })
                            .fold(0.0, f64::max)
                    };
                    let worst = off(&pieces, &whole).max(off(&whole, &pieces));
                    assert!(worst <= 10.0, "blob {blob}, {delta} {join:?}: {worst} units off");
                    checked += 1;
                }
            }
        }
        assert!(checked > 20, "{checked}");
    }

    #[test]
    fn a_differences_loops_start_where_clipper2_starts_them() {
        // Two overhangs Orca finds (a slice less the layer below grown), with the start Clipper2 gives each, as its
        // own code does for these shapes. A slab out from the side of a pillar: its bottom edge lies on the slab's,
        // which the sweep runs along to the right, so the loop starts after its lowest right corner.
        let slab: Shapes = vec![vec![vec![mm(100.0, 140.0), mm(100.0, 120.0), mm(135.0, 120.0), mm(135.0, 140.0)]]];
        let pillar: Shapes = vec![vec![vec![mm(99.7, 140.3), mm(99.7, 119.7), mm(110.3, 119.7), mm(110.3, 140.3)]]];
        let mut out = difference(&slab, &pillar);
        clipper2_start(&mut out, &[&slab, &pillar]);
        assert_eq!(out, vec![vec![vec![mm(135.0, 140.0), mm(110.3, 140.0), mm(110.3, 120.0), mm(135.0, 120.0)]]]);
        // An arm out from a fin: its bottom edge is a step of the outline that climbs to it and on, which the sweep
        // runs along to the left, so the loop starts at its lowest right corner.
        let arm: Shapes = vec![vec![vec![
            mm(100.0, 130.0),
            mm(100.0, 110.0),
            mm(104.0, 110.0),
            mm(104.0, 115.0),
            mm(114.0, 115.0),
            mm(114.0, 125.0),
            mm(104.0, 125.0),
            mm(104.0, 130.0),
        ]]];
        let fin: Shapes = vec![vec![vec![mm(99.7, 130.3), mm(99.7, 109.7), mm(104.3, 109.7), mm(104.3, 130.3)]]];
        let mut out = difference(&arm, &fin);
        clipper2_start(&mut out, &[&arm, &fin]);
        assert_eq!(out, vec![vec![vec![mm(114.0, 115.0), mm(114.0, 125.0), mm(104.3, 125.0), mm(104.3, 115.0)]]]);
    }

    #[test]
    fn clipper2_offsets_mitre_square_and_round_as_orca_sets_them_up() {
        let square: Shapes = vec![vec![vec![mm(0.0, 0.0), mm(10.0, 0.0), mm(10.0, 10.0), mm(0.0, 10.0)]]];
        // Right angles mitre within the limit of 2: a 12 mm square; shrunk, the edges meet at their crossings.
        let grown = offset_c2(&square, 1.0, Join::Miter(1.2));
        assert_eq!(bbox(&grown), Some([sc(-1.0), sc(-1.0), sc(11.0), sc(11.0)]));
        assert!((area_mm2(&grown) - 144.0).abs() < 1e-6);
        let shrunk = offset_c2(&square, -1.0, Join::Miter(1.2));
        assert!((area_mm2(&shrunk) - 64.0).abs() < 1e-6);
        // Round: a quarter turn in steps of a fixed angle, as many as the tolerance asks (5 for 0.012 mm at 1 mm),
        // each point on the circle.
        let round = offset_c2(&square, 1.0, Join::Round(0.012));
        let corner = 0.5 * 5.0 * (std::f64::consts::FRAC_PI_2 / 5.0).sin();
        assert!((area_mm2(&round) - (140.0 + 4.0 * corner)).abs() < 1e-3, "{}", area_mm2(&round));
        assert_eq!(round[0][0].len(), 4 * 6);
        // A spike of 26.6° goes beyond the mitre limit of 2 (60°): squared off as with Square. The corner of 63.4°
        // at its top stays within it, mitred, so it reaches further up than the squared one.
        let spike: Shapes = vec![vec![vec![mm(0.0, 0.0), mm(20.0, 0.0), mm(0.0, 10.0)]]];
        let mitred = bbox(&offset_c2(&spike, 1.0, Join::Miter(1.2))).unwrap();
        let squared = bbox(&offset_c2(&spike, 1.0, Join::Square)).unwrap();
        assert_eq!(mitred[2], squared[2]);
        assert!(squared[2] < sc(21.5), "{}", squared[2]);
        assert!(mitred[3] > squared[3] + sc(0.1), "{} {}", mitred[3], squared[3]);
    }

    #[test]
    fn an_open_path_covers_a_band_with_flat_ends_and_squared_corners() {
        // A straight line: a rectangle, flat at both ends.
        let band = offset_open(&[mm(0.0, 0.0), mm(10.0, 0.0)], 0.2);
        assert!((area_mm2(&band) - 4.0).abs() < 1e-6, "{}", area_mm2(&band));
        assert_eq!(bbox(&band), Some([0, sc(-0.2), sc(10.0), sc(0.2)]));
        // A turn: both arms, the corner outside squared off 0.2 mm out from it (a corner of 0.2² less a triangle
        // whose legs are 0.4 − 0.2·√2).
        let leg = 0.4 - 0.2 * 2f64.sqrt();
        let corner = 0.04 - leg * leg / 2.0;
        let band = offset_open(&[mm(0.0, 0.0), mm(10.0, 0.0), mm(10.0, 10.0)], 0.2);
        assert!((area_mm2(&band) - (8.0 - 0.04 + corner)).abs() < 1e-3, "{}", area_mm2(&band));
        // A loop back to its start: a ring, flat where it starts and ends.
        let square = [mm(0.0, 0.0), mm(10.0, 0.0), mm(10.0, 10.0), mm(0.0, 10.0), mm(0.0, 0.0)];
        let ring = offset_open(&square, 0.2);
        assert_eq!(ring.len(), 1);
        assert_eq!(ring[0].len(), 2, "a ring with its hole");
        assert!((area_mm2(&ring) - (16.0 - 0.16 + 3.0 * corner)).abs() < 1e-3, "{}", area_mm2(&ring));
        // A point: a square round it; nothing for no width.
        assert!((area_mm2(&offset_open(&[mm(1.0, 1.0)], 0.2)) - 0.16).abs() < 1e-6);
        assert!(offset_open(&[mm(0.0, 0.0), mm(1.0, 0.0)], 0.0).is_empty());
    }

    #[test]
    fn a_line_that_doubles_back_keeps_its_turn() {
        // Every point lies on one straight line, but the line runs past its end and back: measured to the segment,
        // as Orca measures, the far end stays.
        let line = [mm(0.0, 0.0), mm(5.0, 0.0), mm(2.0, 0.0)];
        assert_eq!(simplify_line(&line, 0.04), line.to_vec());
    }
}
