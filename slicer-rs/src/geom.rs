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

/// `offset` with every corner bevelled: what Clipper's round joins come to at the coarse arc tolerance Orca grows
/// regions with (a turn under about 120° gets a single chord).
pub fn offset_bevel(shapes: &Shapes, delta: f64) -> Shapes {
    let d = sc(delta);
    if shapes.is_empty() || d == 0 {
        return shapes.clone();
    }
    shapes.outline(&IntOutlineStyle::new(d).line_join(IntLineJoin::Bevel)).unwrap_or_default()
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
pub fn contains(shapes: &Shapes, p: Pt) -> bool {
    let mut winding = 0i32;
    for shape in shapes {
        for contour in shape {
            winding += winding_number(contour, p);
        }
    }
    winding != 0
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
pub fn segment_inside(shapes: &Shapes, a: Pt, b: Pt) -> bool {
    if !contains(shapes, a) {
        return false;
    }
    let (lo_x, hi_x) = (a.x.min(b.x), a.x.max(b.x));
    let (lo_y, hi_y) = (a.y.min(b.y), a.y.max(b.y));
    for shape in shapes {
        for contour in shape {
            let n = contour.len();
            for i in 0..n {
                let (c, d) = (contour[i], contour[(i + 1) % n]);
                if c.x.max(d.x) < lo_x || c.x.min(d.x) > hi_x || c.y.max(d.y) < lo_y || c.y.min(d.y) > hi_y {
                    continue;
                }
                if segments_cross(a, b, c, d) {
                    return false;
                }
            }
        }
    }
    true
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
