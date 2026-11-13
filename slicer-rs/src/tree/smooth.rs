//! Orca's `smooth_outward` (OrcaSlicer 2.5's `MutablePolygon.cpp`, after CuraEngine's): fills a region's sharp
//! notches and narrow cracks, growing it. The trees run it on each layer's branch areas before simplifying them
//! (`TreeSupport3D.cpp`, `smooth_outward(union_(base), 419999)`), and on their interface areas once closed
//! (`SupportCommon.cpp`, 565 618 nm).
//!
//! Each contour is smoothed alone, holes too. After points closer than 10 µm to the one before are dropped, its
//! points are visited once each, from its first. Where it turns clockwise by more than 45° (a concave corner sharper
//! than 135° of an outer contour, or a convex corner of a hole), the corner point is removed and the notch it leaves
//! is filled: a notch narrower than the clip distance is followed inwards while its sides stay that close and cut
//! across where they part (`clip_narrow_corner`), a wider corner is cut across at the clip distance. A clockwise
//! triangle left lower than the clip distance is cleared, and so is a contour left with fewer than 3 points.
//!
//! Ported line by line, since the result's points and where it starts matter (the Douglas–Peucker simplification
//! after it keeps the first point): the contour is Orca's loop of linked points (`MutablePolygon`), visited in its
//! order with its range of points not yet visited, in nanometres, with Orca's integer and floating-point arithmetic
//! and truncations, its odd cuts included. Two of its multiply-adds are fused (`mul_add`), as GCC fuses them in the
//! native Orca 2.5 for Linux (aarch64) that the slicer is checked against: unfused, 2 of 42 904 test contours came
//! out with a point 1 nm away from that build's, where a cut landed within a rounding of a whole nanometre.

use crate::geom::{self, Contour, Shapes};

/// A point or a vector in nanometres.
type P = (i64, i64);

/// No point: an invalid index, Orca's `-1`.
const NONE: i32 = -1;

/// Orca's `SCALED_EPSILON` (`EPSILON / SCALING_FACTOR`): 100 nm and a hair over, as the division rounds.
const SCALED_EPSILON: f64 = 1e-4 / 0.000_001;

/// nm: a point this close to the one before it is dropped first (Orca's `scaled<double>(0.01)`).
const DUPLICATE: f64 = 0.01 / 0.000_001;

/// The region's contours smoothed outwards with a clip distance of `clip_dist_nm`, each alone (Orca's
/// `smooth_outward` of polygons), in nanometres and rounded back to the nearest unit. A shape whose outer contour
/// comes back with fewer than 3 points is dropped, holes and all, and so is a hole that does; the rest are not
/// unioned.
pub fn smooth_outward(shapes: &Shapes, clip_dist_nm: i64) -> Shapes {
    let smooth = |contour: &Contour| -> Contour {
        let nm = contour.iter().map(|p| (p.x as i64 * 100, p.y as i64 * 100)).collect();
        smooth_outward_nm(nm, clip_dist_nm).into_iter().map(|(x, y)| geom::pt(unit(x), unit(y))).collect()
    };
    let mut out = Vec::with_capacity(shapes.len());
    for shape in shapes {
        let Some((outer, holes)) = shape.split_first() else { continue };
        let outer = smooth(outer);
        if outer.len() < 3 {
            continue;
        }
        let mut smoothed = vec![outer];
        smoothed.extend(holes.iter().map(smooth).filter(|hole| hole.len() >= 3));
        out.push(smoothed);
    }
    out
}

/// One contour, nm, smoothed outwards with a clip distance of `clip_dist` nm (Orca's `smooth_outward` of a
/// `MutablePolygon`, read back from its first point). It comes back empty when fewer than 3 points are left, as
/// Orca's `MutablePolygon::polygon` reads such a contour, and is then dropped.
pub fn smooth_outward_nm(points: Vec<(i64, i64)>, clip_dist: i64) -> Vec<(i64, i64)> {
    let mut poly = Loop::new(&points);
    smooth(&mut poly, clip_dist);
    poly.points()
}

/// Rounds nanometres to the nearest unit (0.1 µm).
fn unit(nm: i64) -> i32 {
    (nm as f64 / 100.0).round() as i32
}

/// Orca's `MutablePolygon`: a contour as a loop of points linked both ways, all in one vector, so that a point's
/// index (Orca's iterator) stays the same while others are removed and inserted. Removed points go on a free list
/// that inserted ones reuse.
struct Loop {
    nodes: Vec<Node>,
    /// Points in the loop.
    len: usize,
    /// Where the loop starts (`begin()`), or `NONE` when it is empty.
    head: i32,
    /// The first removed point free for reuse, or `NONE`.
    free: i32,
}

#[derive(Clone, Copy)]
struct Node {
    p: P,
    prev: i32,
    next: i32,
}

impl Loop {
    /// The points in order, the first one first (`assign`).
    fn new(points: &[P]) -> Loop {
        let n = points.len() as i32;
        let mut nodes = Vec::with_capacity(points.len() * 2);
        nodes.extend(points.iter().enumerate().map(|(i, &p)| {
            let i = i as i32;
            Node { p, prev: if i == 0 { n - 1 } else { i - 1 }, next: if i == n - 1 { 0 } else { i + 1 } }
        }));
        Loop { nodes, len: points.len(), head: if n > 0 { 0 } else { NONE }, free: NONE }
    }

    fn p(&self, i: i32) -> P {
        self.nodes[i as usize].p
    }

    fn set(&mut self, i: i32, p: P) {
        self.nodes[i as usize].p = p;
    }

    fn prev(&self, i: i32) -> i32 {
        self.nodes[i as usize].prev
    }

    fn next(&self, i: i32) -> i32 {
        self.nodes[i as usize].next
    }

    /// The last point before the loop comes round to its first (Orca's `end()`), or `NONE` when it is empty.
    fn last(&self) -> i32 {
        if self.len == 0 { NONE } else { self.prev(self.head) }
    }

    /// Takes point `i` out and returns the one after it, or `NONE` when it was the last left. If it was the first,
    /// the one after it becomes the first.
    fn remove(&mut self, i: i32) -> i32 {
        let Node { prev, next, .. } = self.nodes[i as usize];
        self.nodes[i as usize].next = self.free;
        self.free = i;
        self.len -= 1;
        if self.len == 0 {
            self.head = NONE;
            return NONE;
        }
        if self.head == i {
            self.head = next;
        }
        self.nodes[prev as usize].next = next;
        self.nodes[next as usize].prev = prev;
        next
    }

    /// Puts `p` in before point `i` and returns its index; the first point stays the first.
    fn insert(&mut self, i: i32, p: P) -> i32 {
        let j = self.prev(i);
        let n = if self.free == NONE {
            self.nodes.push(Node { p, prev: j, next: i });
            self.nodes.len() as i32 - 1
        } else {
            let n = self.free;
            self.free = self.next(n);
            self.nodes[n as usize] = Node { p, prev: j, next: i };
            n
        };
        self.nodes[j as usize].next = n;
        self.nodes[i as usize].prev = n;
        self.len += 1;
        n
    }

    fn clear(&mut self) {
        self.nodes.clear();
        self.len = 0;
        self.head = NONE;
        self.free = NONE;
    }

    /// The points from the first, or none when fewer than 3 are left (Orca's `polygon()`).
    fn points(&self) -> Vec<P> {
        if self.len < 3 {
            return Vec::new();
        }
        let mut out = Vec::with_capacity(self.len);
        let mut i = self.head;
        loop {
            out.push(self.p(i));
            i = self.next(i);
            if i == self.head {
                return out;
            }
        }
    }
}

/// The points not yet visited (Orca's `MutablePolygon::range`): from `begin` to `end` along the loop, both included,
/// both `NONE` once none are left. Removing a point at either end moves that end past it first.
struct Unvisited {
    begin: i32,
    end: i32,
}

impl Unvisited {
    fn is_empty(&self) -> bool {
        self.begin < 0
    }

    fn make_empty(&mut self) {
        self.begin = NONE;
        self.end = NONE;
    }

    /// The first point not yet visited, which counts as visited from now on.
    fn process_next(&mut self, poly: &Loop) -> i32 {
        let out = self.begin;
        self.advance_front(poly);
        out
    }

    fn advance_front(&mut self, poly: &Loop) {
        if self.begin == self.end { self.make_empty() } else { self.begin = poly.next(self.begin) }
    }

    fn retract_back(&mut self, poly: &Loop) {
        if self.begin == self.end { self.make_empty() } else { self.end = poly.prev(self.end) }
    }

    /// Removes point `i` from the loop, past the range's front if it is there; returns the point after it.
    fn remove_front(&mut self, poly: &mut Loop, i: i32) -> i32 {
        if !self.is_empty() && self.begin == i {
            self.advance_front(poly);
        }
        poly.remove(i)
    }

    /// Removes point `i` from the loop, back past the range's end if it is there; returns the point after it.
    fn remove_back(&mut self, poly: &mut Loop, i: i32) -> i32 {
        if !self.is_empty() && self.end == i {
            self.retract_back(poly);
        }
        poly.remove(i)
    }

    /// Removes point `i` as `remove_back` does and returns the point before it (Orca's `remove_back(it).prev()`).
    fn remove_back_prev(&mut self, poly: &mut Loop, i: i32) -> i32 {
        let next = self.remove_back(poly, i);
        poly.prev(next)
    }
}

fn sub(a: P, b: P) -> P {
    (a.0 - b.0, a.1 - b.1)
}

/// `a` moved by `v`, wrapping as Orca's integers do when a degenerate cut sends a point to infinity.
fn add(a: P, v: P) -> P {
    (a.0.wrapping_add(v.0), a.1.wrapping_add(v.1))
}

fn dot(a: P, b: P) -> i64 {
    a.0 * b.0 + a.1 * b.1
}

fn cross(a: P, b: P) -> i64 {
    a.0 * b.1 - a.1 * b.0
}

fn norm2(a: P) -> i64 {
    dot(a, a)
}

fn float(v: P) -> (f64, f64) {
    (v.0 as f64, v.1 as f64)
}

/// Each part truncated towards zero (Orca's `cast<coord_t>()`).
fn trunc(v: (f64, f64)) -> P {
    (v.0 as i64, v.1 as i64)
}

/// Orca's `remove_duplicates(MutablePolygon&, double eps)`: drops each point closer than `eps` to the point before
/// it, once round from the second point, so the first point stays and the last isn't measured against it.
fn remove_duplicates(poly: &mut Loop, eps: f64) {
    if poly.len == 0 {
        return;
    }
    let eps2 = eps * eps;
    let begin = poly.head;
    let mut it = poly.next(begin);
    while it != begin {
        let (dx, dy) = float(sub(poly.p(it), poly.p(poly.prev(it))));
        it = if dx * dx + dy * dy < eps2 { poly.remove(it) } else { poly.next(it) };
    }
}

/// Orca's `smooth_outward(MutablePolygon&, coord_t)`.
fn smooth(poly: &mut Loop, clip_dist: i64) {
    remove_duplicates(poly, DUPLICATE);

    let clip_dist2 = clip_dist * clip_dist;
    let clip_dist2eps = (clip_dist + SCALED_EPSILON as i64).pow(2);
    let foot_dist_min2 = SCALED_EPSILON * SCALED_EPSILON;

    // Each of the points it starts with is visited once.
    let mut unvisited = Unvisited { begin: poly.head, end: poly.last() };
    while !unvisited.is_empty() && poly.len > 2 {
        let it1 = unvisited.process_next(poly);
        let mut it0 = poly.prev(it1);
        let mut it2 = poly.next(it1);
        let (p0, p1, p2) = (poly.p(it0), poly.p(it1), poly.p(it2));
        let v1 = sub(p0, p1);
        let v2 = sub(p2, p1);
        if cross(v1, v2) <= 0 {
            continue;
        }
        // A concave corner.
        let dot = dot(v1, v2);
        let mut l2v1 = norm2(v1) as f64;
        let mut l2v2 = norm2(v2) as f64;
        // Sharper than 135°.
        if !(dot > 0 || (dot as f64) * (dot as f64) * 2.0 < l2v1 * l2v2) {
            continue;
        }
        let l2v02 = norm2(sub(p2, p0));
        poly.remove(it1);
        if l2v02 < clip_dist2 {
            // A narrow crack: clipped further along its sides, left of p0 and right of p2, while they stay close.
            if clip_narrow_corner(poly, p1, &mut it0, &mut it2, &mut unvisited, l2v02, clip_dist) {
                // Down to nothing, or to a single counter-clockwise triangle.
                return;
            }
        } else if l2v02 > clip_dist2eps {
            // A wider corner, cut across.
            let mut v1d = float(v1);
            let mut v2d = float(v2);
            // The shorter side first.
            let swap = l2v1 > l2v2;
            if swap {
                std::mem::swap(&mut v1d, &mut v2d);
                std::mem::swap(&mut l2v1, &mut l2v2);
            }
            let lv1 = l2v1.sqrt();
            let lv2 = l2v2.sqrt();
            let bisector = (v1d.0 / lv1 + v2d.0 / lv2, v1d.1 / lv1 + v2d.1 / lv2);
            let l2bisector = bisector.0 * bisector.0 + bisector.1 * bisector.1;
            let along = v1d.0 * bisector.0 + v1d.1 * bisector.1;
            // The squared distance of the shorter side's end from the bisector.
            let d2 = l2v1 - along * along / l2bisector;
            if d2 < foot_dist_min2 {
                // The triangle p0, p1, p2 is too low to matter: p1 alone goes.
            } else if d2 < 0.25 * clip_dist2 as f64 + SCALED_EPSILON {
                // The shorter side lies close to the bisector: cut it off whole, and the longer side where it is
                // the clip distance from the shorter side's end.
                let b = -2.0 * (v1d.0 * v2d.0 + v1d.1 * v2d.1);
                let u = b.mul_add(b, -4.0 * l2v2 * (l2v1 - clip_dist2 as f64));
                let t = (-b + u.sqrt()) / (2.0 * l2v2);
                poly.insert(it2, add(p1, trunc((t * v2d.0, t * v2d.1))));
            } else {
                // Cut across the bisector, the clip distance wide.
                let t = (0.25 * clip_dist2 as f64 / d2).sqrt();
                let t2 = t * lv1 / lv2;
                let mut q0 = add(p1, trunc((v1d.0 * t, v1d.1 * t)));
                let mut q2 = add(p1, trunc((v2d.0 * t2, v2d.1 * t2)));
                if swap {
                    std::mem::swap(&mut q0, &mut q2);
                }
                let at = poly.insert(it2, q2);
                poly.insert(at, q0);
            }
        }
        // Otherwise p0 and p2 lie the clip distance apart, or up to 100 nm more: p1 alone goes.
    }

    if poly.len == 3 {
        // A clockwise triangle (a hole) lower than the clip distance is filled in.
        let h = poly.head;
        let (p0, p1, p2) = (poly.p(poly.prev(h)), poly.p(h), poly.p(poly.next(h)));
        let mut v1 = sub(p0, p1);
        let mut v2 = sub(p2, p1);
        if cross(v1, v2) > 0 {
            let v3 = sub(p2, p0);
            let mut l12 = norm2(v1);
            let mut l22 = norm2(v2);
            let l32 = norm2(v3);
            if l22 > l12 && l22 > l32 {
                std::mem::swap(&mut v1, &mut v2);
                std::mem::swap(&mut l12, &mut l22);
            } else if l32 > l12 && l32 > l22 {
                v1 = v3;
                l12 = l32;
            }
            let d = dot(v1, v2) as f64;
            let h2 = l22 as f64 - d * d / l12 as f64;
            if h2 < clip_dist2 as f64 {
                poly.clear();
            }
        }
    } else if poly.len < 3 {
        poly.clear();
    }
}

/// Which way a narrow crack's clipping edge can still move along one of its sides.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Side {
    /// It can move on.
    Free,
    /// The next diagonal would leave the polygon.
    Blocked,
    /// The next diagonal would be longer than the clip distance.
    Far,
}

/// Orca's `clip_narrow_corner` (after CuraEngine's `smooth_corner_complex`). The concave corner `p1` has been
/// removed between `it0` and `it2`, which lie closer than `shortcut_length`; this closes the crack further, moving
/// the clipping edge left from `it0` and right from `it2` while it stays shorter than `shortcut_length` and inside
/// the polygon, then cuts the last trapezoid with an edge `shortcut_length` long. `it0` and `it2` end on the final
/// clipping edge. True when the polygon closed up completely, or a single counter-clockwise triangle is left, which
/// is not smoothed further.
fn clip_narrow_corner(
    poly: &mut Loop,
    p1: P,
    it0: &mut i32,
    it2: &mut i32,
    unvisited: &mut Unvisited,
    mut dist2_current: i64,
    shortcut_length: i64,
) -> bool {
    use Side::{Blocked, Far, Free};
    let shortcut_length2 = shortcut_length * shortcut_length;
    let mut forward = Free;
    let mut backward = Free;
    let mut p0 = poly.p(*it0);
    let mut p2 = poly.p(*it2);
    let mut p02: P = (0, 0);
    let mut p22: P = (0, 0);
    let mut dist2_next: i64 = 0;

    // As long as there is a triangle left.
    while poly.len >= 3 {
        if forward == Far && backward == Far {
            p02 = poly.p(poly.prev(*it0));
            p22 = poly.p(poly.next(*it2));
            let d2 = norm2(sub(p22, p02));
            if d2 <= shortcut_length2 {
                // Still narrow: trim both sides.
                *it0 = unvisited.remove_back_prev(poly, *it0);
                *it2 = unvisited.remove_front(poly, *it2);
                if poly.len <= 2 {
                    // A hole closed up.
                    return true;
                }
                forward = Free;
                backward = Free;
                dist2_current = d2;
                p0 = p02;
                p2 = p22;
            } else {
                // Widening: stop, and trim the last trapezoid.
                dist2_next = d2;
                break;
            }
        } else if forward != Free && backward != Free {
            // One side blocked, the other blocked or far.
            break;
        }
        // Flip a diagonal, on the side that keeps the clipping edge's ends about as far from p1.
        if forward == Free && (backward != Free || norm2(sub(p2, p1)) < norm2(sub(p0, p1))) {
            p22 = poly.p(poly.next(*it2));
            if cross(sub(p2, p0), sub(p22, p0)) > 0 {
                forward = Blocked;
            } else {
                let d2 = norm2(sub(p22, p0));
                if d2 > shortcut_length2 {
                    forward = Far;
                    dist2_next = d2;
                } else {
                    forward = Free;
                    *it2 = unvisited.remove_front(poly, *it2);
                    p2 = p22;
                    dist2_current = d2;
                }
            }
        } else {
            p02 = poly.p(poly.prev(*it0));
            if cross(sub(p02, p2), sub(p0, p2)) > 0 {
                backward = Blocked;
            } else {
                let d2 = norm2(sub(p2, p02));
                if d2 > shortcut_length2 {
                    backward = Far;
                    dist2_next = d2;
                } else {
                    backward = Free;
                    *it0 = unvisited.remove_back_prev(poly, *it0);
                    p0 = p02;
                    dist2_current = d2;
                }
            }
        }
    }

    if poly.len <= 3 {
        // A hole closed up, or a tiny triangle is left: kept if counter-clockwise (one side blocked).
        if poly.len < 3 || (forward == Far && backward == Far) {
            poly.clear();
        }
        return true;
    }

    let short2 = (shortcut_length - SCALED_EPSILON as i64).pow(2);
    if (forward == Blocked && backward == Blocked) || dist2_current > short2 {
        // The crack is filled: the last clipping edge stays.
    } else if dist2_next < short2 {
        // One more step on the far sides, rather than a tiny edge.
        if forward == Far {
            *it0 = unvisited.remove_back_prev(poly, *it0);
        }
        if backward == Far {
            *it2 = unvisited.remove_front(poly, *it2);
        }
        if poly.len <= 2 {
            return true;
        }
    } else if forward == Blocked || backward == Blocked {
        // One side far, the other blocked: the far side's edge (from p0 towards p02, sides sorted) is clipped where
        // it is `shortcut_length` from p2, but as Orca has it, the blocked side's point moves by that much instead,
        // which can cut a sliver off the region.
        if forward == Far {
            std::mem::swap(&mut p0, &mut p2);
            std::mem::swap(&mut p02, &mut p22);
        }
        let v = float(sub(p02, p0));
        let d = float(sub(p0, p2));
        let a = v.0 * v.0 + v.1 * v.1;
        let dot = d.0 * v.0 + d.1 * v.1;
        let b = 2.0 * dot;
        let u = b.mul_add(b, -4.0 * a * (d.0 * d.0 + d.1 * d.1 - shortcut_length2 as f64)).sqrt();
        let t = (-b + u) / (2.0 * a);
        let at = if backward == Far { *it2 } else { *it0 };
        poly.set(at, add(poly.p(at), trunc((v.0 * t, v.1 * t))));
    } else {
        // Both far: the trapezoid (prev of it0, it0, it2, next of it2) widens; trim it.
        let dcurrent = (dist2_current as f64).sqrt();
        let t = (shortcut_length as f64 - dcurrent) / ((dist2_next as f64).sqrt() - dcurrent);
        let (w0, w2) = (float(sub(p02, p0)), float(sub(p22, p2)));
        poly.set(*it0, add(poly.p(*it0), trunc((w0.0 * t, w0.1 * t))));
        poly.set(*it2, add(poly.p(*it2), trunc((w2.0 * t, w2.1 * t))));
    }
    false
}

#[cfg(test)]
mod tests {
    //! The expected points are native OrcaSlicer 2.5.0's: its own `smooth_outward`, run on the same contours.
    use super::*;

    /// The trees' base smoothing distance, nm.
    const CLIP: i64 = 419_999;

    /// Points from pairs of numbers, nm.
    fn pts(v: &[i64]) -> Vec<P> {
        v.chunks(2).map(|c| (c[0], c[1])).collect()
    }

    /// Twice the signed area: positive counter-clockwise.
    fn area2(points: &[P]) -> i128 {
        let n = points.len();
        (0..n).map(|i| cross(points[i], points[(i + 1) % n]) as i128).sum()
    }

    #[test]
    fn the_constants_are_orcas() {
        // Orca's division rounds SCALED_EPSILON a hair over 100, which only its squares and sums see.
        assert_eq!(SCALED_EPSILON, 100.00000000000001);
        assert_eq!(SCALED_EPSILON as i64, 100);
        assert_eq!(DUPLICATE * DUPLICATE, 1e8);
    }

    #[test]
    fn a_convex_polygon_stays_as_it_was() {
        let square = pts(&[0, 0, 10_000_000, 0, 10_000_000, 10_000_000, 0, 10_000_000]);
        assert_eq!(smooth_outward_nm(square.clone(), CLIP), square);
        let from_a_corner = pts(&[10_000_000, 10_000_000, 0, 10_000_000, 0, 0, 10_000_000, 0]);
        assert_eq!(smooth_outward_nm(from_a_corner.clone(), CLIP), from_a_corner);
        let hexagon: Vec<P> = (0..6)
            .map(|k| {
                let a = k as f64 * std::f64::consts::PI / 3.0;
                ((2e6 * a.cos()) as i64, (2e6 * a.sin()) as i64)
            })
            .collect();
        assert_eq!(smooth_outward_nm(hexagon.clone(), CLIP), hexagon);
        // A point within 10 µm of the one before goes, but the last isn't measured against the first.
        let close = pts(&[0, 0, 10_000_000, 0, 10_005_000, 3_000, 10_000_000, 10_000_000, 0, 10_000_000, 0, 5_000]);
        assert_eq!(
            smooth_outward_nm(close, CLIP),
            pts(&[0, 0, 10_000_000, 0, 10_000_000, 10_000_000, 0, 10_000_000, 0, 5_000])
        );
    }

    #[test]
    fn a_sharp_notch_is_filled() {
        // A V notch 2 mm wide and 2 mm deep in the top of a 10 mm square: its bottom is cut across the bisector,
        // the clip distance wide.
        let notch = pts(&[
            0, 0, 10_000_000, 0, 10_000_000, 10_000_000, 6_000_000, 10_000_000, 5_000_000, 8_000_000, 4_000_000,
            10_000_000, 0, 10_000_000,
        ]);
        let out = smooth_outward_nm(notch.clone(), CLIP);
        assert_eq!(
            out,
            pts(&[
                0, 0, 10_000_000, 0, 10_000_000, 10_000_000, 6_000_000, 10_000_000, 5_209_999, 8_419_999, 4_790_001,
                8_419_999, 4_000_000, 10_000_000, 0, 10_000_000,
            ])
        );
        assert!(area2(&out) > area2(&notch));

        // 9.5 mm deep, it is filled up to where it is the clip distance wide.
        let deep = pts(&[
            0, 0, 10_000_000, 0, 10_000_000, 10_000_000, 6_000_000, 10_000_000, 5_000_000, 500_000, 4_000_000,
            10_000_000, 0, 10_000_000,
        ]);
        assert_eq!(
            smooth_outward_nm(deep, CLIP),
            pts(&[
                0, 0, 10_000_000, 0, 10_000_000, 10_000_000, 6_000_000, 10_000_000, 5_209_999, 2_494_995, 4_790_001,
                2_494_995, 4_000_000, 10_000_000, 0, 10_000_000,
            ])
        );

        // One side short and close to the bisector: it goes whole, and the long side is cut where it is the clip
        // distance from the short side's end.
        let lopsided = pts(&[
            0, 0, 10_000_000, 0, 10_000_000, 10_000_000, 5_000_000, 10_000_000, 5_000_000, 9_750_000, 2_000_000,
            10_000_000, 0, 10_000_000,
        ]);
        assert_eq!(
            smooth_outward_nm(lopsided, CLIP),
            pts(&[
                0, 0, 10_000_000, 0, 10_000_000, 10_000_000, 5_000_000, 10_000_000, 4_642_351, 9_779_804, 2_000_000,
                10_000_000, 0, 10_000_000,
            ])
        );
    }

    #[test]
    fn a_narrow_crack_is_clipped() {
        // A slot 0.2 mm wide and 3 mm deep with a pointed bottom, in the top of a 10 mm square: narrower than the
        // clip distance all the way, so it is closed up to its mouth, whose ends then move apart along the top
        // until they are the clip distance apart.
        let slot = pts(&[
            0, 0, 10_000_000, 0, 10_000_000, 10_000_000, 5_100_000, 10_000_000, 5_100_000, 7_500_000, 5_000_000,
            7_000_000, 4_900_000, 7_500_000, 4_900_000, 10_000_000, 0, 10_000_000,
        ]);
        assert_eq!(
            smooth_outward_nm(slot, CLIP),
            pts(&[
                0, 0, 10_000_000, 0, 10_000_000, 10_000_000, 5_209_999, 10_000_000, 4_790_001, 10_000_000, 0,
                10_000_000
            ])
        );

        // A crack that eats a small island down to a triangle leaves the triangle.
        let dart = pts(&[0, 0, 200_000, 150_000, 400_000, 0, 200_000, 200_000]);
        assert_eq!(smooth_outward_nm(dart, CLIP), pts(&[0, 0, 400_000, 0, 200_000, 200_000]));

        // A crack beside a corner, 0.2 mm wide at its mouth: one side reaches the far end of the top edge, the
        // other turns down the square's side. As Orca has it, the corner on the turning side moves along the top by
        // the cut's length (the region loses a sliver there).
        let beside =
            pts(&[0, 0, 2_000_000, 0, 2_000_000, 2_000_000, 1_900_000, 1_000_000, 1_800_000, 2_000_000, 0, 2_000_000]);
        assert_eq!(
            smooth_outward_nm(beside, CLIP),
            pts(&[0, 0, 2_000_000, 0, 1_780_001, 2_000_000, 1_800_000, 2_000_000, 0, 2_000_000])
        );
    }

    #[test]
    fn a_holes_convex_corners_count_as_concave() {
        // A clockwise square hole: each corner turns clockwise by 90° and is cut across, so the hole shrinks to an
        // octagon. Its first point is cut away, so it starts at the first cut's.
        let hole = pts(&[0, 0, 0, 5_000_000, 5_000_000, 5_000_000, 5_000_000, 0]);
        let out = smooth_outward_nm(hole.clone(), CLIP);
        assert_eq!(
            out,
            pts(&[
                296_984, 0, 0, 296_984, 0, 4_703_016, 296_984, 5_000_000, 4_703_016, 5_000_000, 5_000_000, 4_703_016,
                5_000_000, 296_984, 4_703_016, 0,
            ])
        );
        assert!(area2(&out) < 0 && area2(&out) > area2(&hole));
        // The same square counter-clockwise is left alone.
        let mut outer = hole;
        outer.reverse();
        assert_eq!(smooth_outward_nm(outer.clone(), CLIP), outer);
    }

    #[test]
    fn a_low_clockwise_triangle_is_cleared() {
        // A clockwise sliver 0.3 mm high and 4 mm long goes; counter-clockwise, it stays.
        let sliver = pts(&[0, 0, 2_000_000, 300_000, 4_000_000, 0]);
        assert!(smooth_outward_nm(sliver.clone(), CLIP).is_empty());
        let mut island = sliver;
        island.reverse();
        assert_eq!(smooth_outward_nm(island.clone(), CLIP), island);
        // A clockwise triangle 0.55 mm high: its corners are cut in turn until a triangle lower than the clip
        // distance is left, which the last check fills in.
        assert!(smooth_outward_nm(pts(&[200_000, 100_000, 0, 1_000_000, 700_000, 1_200_000]), CLIP).is_empty());
        // A taller one keeps its cut corners.
        assert_eq!(
            smooth_outward_nm(pts(&[0, 0, 1_000_000, 1_700_000, 2_000_000, 0]), CLIP),
            pts(&[
                422_978, 0, 214_458, 364_579, 790_001, 1_343_001, 1_209_999, 1_343_001, 1_785_542, 364_579, 1_577_022,
                0
            ])
        );
        // Fewer than 3 points come back empty.
        assert!(smooth_outward_nm(pts(&[0, 0, 1_000_000, 0]), CLIP).is_empty());
        assert!(smooth_outward_nm(Vec::new(), CLIP).is_empty());
    }

    #[test]
    fn shapes_lose_what_closes_up() {
        let p = |x: f64, y: f64| geom::pt((x * 1e4).round() as i32, (y * 1e4).round() as i32);
        let square = vec![p(0.0, 0.0), p(10.0, 0.0), p(10.0, 10.0), p(0.0, 10.0)];
        // A hole too low to keep, and one big enough, whose corners are cut.
        let sliver = vec![p(2.0, 2.0), p(4.0, 2.3), p(6.0, 2.0)];
        let hole = vec![p(2.0, 5.0), p(2.0, 8.0), p(8.0, 8.0), p(8.0, 5.0)];
        // An outer contour that closes up, with a hole of its own.
        let gone = vec![p(20.0, 0.0), p(22.0, 0.3), p(24.0, 0.0)];
        let speck = vec![p(21.0, 0.1), p(21.0, 0.2), p(21.1, 0.1)];
        let shapes: Shapes = vec![vec![square.clone(), sliver, hole], vec![gone, speck]];
        let out = smooth_outward(&shapes, CLIP);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].len(), 2);
        assert_eq!(out[0][0], square);
        assert_eq!(out[0][1].len(), 8);
        // Rounded to the nearest unit: the first cut is 0.2969835 mm from the hole's corner.
        assert_eq!(out[0][1][0], p(2.297, 5.0));
    }
}
