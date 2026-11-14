//! The polygon helpers the trees grow with (`TreeSupport3D.cpp`), in Orca's nanometres.

use super::mm;
use crate::geom::{self, Join, Pt, Shapes};

/// Orca's `jtMiter, 1.2`, which its wrapper mitres with a limit of 2.
pub const MITER: Join = Join::Miter(1.2);

/// nm² of shapes, holes taken off (Orca's signed `area`).
pub fn area(shapes: &Shapes) -> f64 {
    geom::area_mm2(shapes) * 1e12
}

/// Shapes offset by nanometres.
pub fn offset(shapes: &Shapes, nm: f64, join: Join) -> Shapes {
    if shapes.is_empty() { Vec::new() } else { geom::offset_c2(shapes, mm(nm), join) }
}

/// Orca's `union_`: all of them as clean shapes. One set alone is taken as it is: every set here comes clean out of
/// a boolean, an offset or a simplification (or is a single circle), and a union would change only where its loops
/// start.
pub fn union(a: &Shapes, b: &Shapes) -> Shapes {
    if b.is_empty() {
        a.clone()
    } else if a.is_empty() {
        b.clone()
    } else {
        geom::union_all(&[a, b])
    }
}

/// Orca's `diff` and `intersection`, by bounding box first (`diff_clipped`).
pub fn diff(a: &Shapes, b: &Shapes) -> Shapes {
    let Some(ba) = geom::bbox(a) else { return Vec::new() };
    let near = geom::near(b, geom::inflate(ba, 1e-4));
    if near.is_empty() { union(a, &Vec::new()) } else { geom::difference(a, &near) }
}

pub fn intersection(a: &Shapes, b: &Shapes) -> Shapes {
    if a.is_empty() || b.is_empty() { Vec::new() } else { geom::intersection(a, b) }
}

/// Orca's `contains` over polygons: whether `p` lies inside an odd number of contours, or on any edge.
pub fn contains(shapes: &Shapes, p: Pt) -> bool {
    let mut inside = false;
    let (px, py) = (p.x as i64, p.y as i64);
    for contour in shapes.iter().flatten() {
        let n = contour.len();
        if n < 3 {
            continue;
        }
        let mut odd = false;
        let mut j = n - 1;
        for i in 0..n {
            let (a, b) = (contour[j], contour[i]);
            let (ax, ay, bx, by) = (a.x as i64, a.y as i64, b.x as i64, b.y as i64);
            // On the edge.
            let cross = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
            if cross == 0 && px >= ax.min(bx) && px <= ax.max(bx) && py >= ay.min(by) && py <= ay.max(by) {
                return true;
            }
            if (ay > py) != (by > py) {
                // Where the edge crosses the point's row, left or right of it.
                let lhs = (px - ax) as i128 * (by - ay) as i128;
                let rhs = (bx - ax) as i128 * (py - ay) as i128;
                if (by > ay && lhs < rhs) || (by < ay && lhs > rhs) {
                    odd = !odd;
                }
            }
            j = i;
        }
        if odd {
            inside = !inside;
        }
    }
    inside
}

/// The point of the shapes' outlines nearest to `from` (Orca's `move_inside` with no distance), or `from` itself
/// with no outline.
pub fn move_inside(shapes: &Shapes, from: Pt) -> Pt {
    let mut best = f64::MAX;
    let mut ret = from;
    let (fx, fy) = (from.x as i64, from.y as i64);
    for poly in shapes.iter().flatten() {
        let n = poly.len();
        if n < 2 {
            continue;
        }
        let p0 = poly[n - 2];
        let mut p1 = poly[n - 1];
        let (dx, dy) = ((p1.x - p0.x) as i64, (p1.y - p0.y) as i64);
        let mut beyond_prev = dx * (fx - p0.x as i64) + dy * (fy - p0.y as i64) >= dx * dx + dy * dy;
        for &p2 in poly {
            let (abx, aby) = ((p2.x - p1.x) as i64, (p2.y - p1.y) as i64);
            let (apx, apy) = (fx - p1.x as i64, fy - p1.y as i64);
            let ab2 = abx * abx + aby * aby;
            if ab2 <= 0 {
                p1 = p2;
                continue;
            }
            let dot = abx * apx + aby * apy;
            if dot <= 0 {
                if beyond_prev {
                    beyond_prev = false;
                    let d2 = ((p1.x as i64 - fx).pow(2) + (p1.y as i64 - fy).pow(2)) as f64;
                    if d2 < best {
                        best = d2;
                        ret = p1;
                    }
                } else {
                    p1 = p2;
                    continue;
                }
            } else if dot >= ab2 {
                beyond_prev = true;
                p1 = p2;
                continue;
            } else {
                beyond_prev = false;
                let t = dot as f64 / ab2 as f64;
                let x = geom::pt(p1.x + (abx as f64 * t) as i32, p1.y + (aby as f64 * t) as i32);
                let d2 = ((fx - x.x as i64).pow(2) + (fy - x.y as i64).pow(2)) as f64;
                if d2 < best {
                    best = d2;
                    ret = x;
                }
            }
            p1 = p2;
        }
    }
    ret
}

/// `from` if it lies in the shapes, else the nearest point of their outlines (`move_inside_if_outside`).
pub fn move_inside_if_outside(shapes: &Shapes, from: Pt) -> Pt {
    if contains(shapes, from) { from } else { move_inside(shapes, from) }
}

/// Orca's `safe_union`: the union, or where thin areas vanish in it, their outlines grown by 2 µm.
pub fn safe_union(a: &Shapes, b: &Shapes) -> Shapes {
    if a.is_empty() && b.is_empty() {
        return Vec::new();
    }
    let r = union(a, b);
    if !r.is_empty() {
        return r;
    }
    let both: Shapes = a.iter().chain(b).cloned().collect();
    outline_strips(&both, 2_000.0)
}

/// The shapes' outlines as closed lines, each grown `nm` either side with flat ends (Orca's `offset` of
/// `to_polylines`), as one area.
pub fn outline_strips(shapes: &Shapes, nm: f64) -> Shapes {
    let mut grown: Shapes = Vec::new();
    for contour in shapes.iter().flatten() {
        let mut line = contour.clone();
        if let Some(&first) = contour.first() {
            line.push(first);
        }
        grown.extend(geom::offset_open(&line, mm(nm)));
    }
    union(&grown, &Vec::new())
}

/// Grows `me` by `distance` nm in steps of at most `safe_step` (each taking out `collision`, so it can't jump a
/// wall), the last `last_unchecked` of it unchecked, in at least `min_steps` steps: Orca's `safe_offset_inc`.
pub fn safe_offset_inc(
    me: &Shapes,
    distance: i64,
    collision: &Shapes,
    safe_step: i64,
    last_unchecked: i64,
    min_steps: usize,
) -> Shapes {
    let mut final_difference = last_unchecked == 0;
    let mut ret = safe_union(me, &Vec::new());
    // Only the collision near the area can matter.
    let near = |ret: &Shapes| -> Shapes {
        geom::bbox(ret)
            .map_or(Vec::new(), |b| geom::near(collision, geom::inflate(b, mm((distance.max(0) + 100) as f64))))
    };
    let collision = near(&ret);
    if distance == 0 || safe_step < 0 || last_unchecked < 0 {
        return if final_difference { diff(&ret, &collision) } else { union(&ret, &Vec::new()) };
    }
    let mut step = safe_step;
    let mut steps: i64 = if distance > last_unchecked { (distance - last_unchecked) / step } else { 0 };
    if distance - steps * step > last_unchecked {
        if (steps + 1) * step <= distance {
            steps += 1;
        } else {
            final_difference = true;
        }
    }
    let extra = i64::from(distance < last_unchecked || distance % step != 0);
    if steps + extra < min_steps as i64 && min_steps > 1 {
        step = distance / min_steps as i64;
        if step >= safe_step {
            step = safe_step;
            steps = min_steps as i64;
        } else {
            steps = distance / step;
        }
    }
    for i in 0..steps {
        ret = diff(&offset(&ret, step as f64, Join::Round(0.01)), &collision);
        if i % 10 == 7 {
            ret = geom::simplify_polygons(&ret, 0.015);
        }
    }
    let last = (distance - steps * step) as f32;
    if last > 100.0 {
        ret = offset(&ret, (distance - steps * step) as f64, Join::Round(0.01));
    }
    ret = geom::simplify_polygons(&ret, 0.015);
    if final_difference {
        ret = diff(&ret, &collision);
    }
    union(&ret, &Vec::new())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn contains_counts_an_edge_inside_and_a_hole_out() {
        let p = |x: i32, y: i32| geom::pt(x, y);
        let ring: Shapes = vec![vec![
            vec![p(0, 0), p(100, 0), p(100, 100), p(0, 100)],
            vec![p(25, 25), p(25, 75), p(75, 75), p(75, 25)],
        ]];
        assert!(contains(&ring, p(10, 10)));
        assert!(!contains(&ring, p(50, 50)));
        assert!(contains(&ring, p(100, 50)) && contains(&ring, p(25, 50)) && contains(&ring, p(0, 0)));
        assert!(!contains(&ring, p(150, 50)));
        // The nearest point of the outlines: onto the hole's edge from inside it, onto a corner from beyond it.
        assert_eq!(move_inside(&ring, p(50, 30)), p(50, 25));
        assert_eq!(move_inside(&ring, p(120, 130)), p(100, 100));
        assert_eq!(move_inside_if_outside(&ring, p(10, 10)), p(10, 10));
    }
}
