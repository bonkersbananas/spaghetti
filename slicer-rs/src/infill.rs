//! Straight-line infill: parallel lines at an angle, on a grid fixed to the plate (so sparse infill stacks from
//! layer to layer), cut to a region by a scanline sweep, then chained: each line continues with the nearest free
//! line on the next scanline, joined by a short extrusion where the joint stays inside the region (a zig-zag),
//! else the run ends there and the next one starts with a travel.

use crate::geom::{self, Contour, Pt, Shapes};

/// A region edge in the frame where the lines are horizontal: from `y0` up to `y1`, at `x0` when at `y0`.
struct Edge {
    y0: f64,
    y1: f64,
    x0: f64,
    dxdy: f64,
    /// +1 if the contour runs upwards along it, −1 downwards (for the winding number).
    dir: i32,
}

impl Edge {
    fn x_at(&self, y: f64) -> f64 {
        self.x0 + (y - self.y0) * self.dxdy
    }
}

/// Lines `spacing` mm apart at `angle` degrees through the region, chained into polylines (each a run to print in
/// one go). `phase` shifts the grid across the lines (mm).
pub fn fill(region: &Shapes, angle_deg: f64, spacing: f64, phase: f64) -> Vec<Contour> {
    if region.is_empty() || spacing <= 0.0 {
        return Vec::new();
    }
    let angle = angle_deg.to_radians();
    let (sin, cos) = angle.sin_cos();
    // Into the frame where the lines are horizontal: rotate by -angle.
    let to_frame = |p: Pt| -> (f64, f64) {
        let (x, y) = (p.x as f64, p.y as f64);
        (x * cos + y * sin, -x * sin + y * cos)
    };
    let from_frame =
        |x: f64, y: f64| -> Pt { geom::pt((x * cos - y * sin).round() as i32, (x * sin + y * cos).round() as i32) };

    let mut edges: Vec<Edge> = Vec::new();
    for shape in region {
        for contour in shape {
            let n = contour.len();
            for i in 0..n {
                let (ax, ay) = to_frame(contour[i]);
                let (bx, by) = to_frame(contour[(i + 1) % n]);
                if ay == by {
                    continue;
                }
                let (x0, y0, x1, y1, dir) = if ay < by { (ax, ay, bx, by, 1) } else { (bx, by, ax, ay, -1) };
                edges.push(Edge { y0, y1, x0, dxdy: (x1 - x0) / (y1 - y0), dir });
            }
        }
    }
    if edges.is_empty() {
        return Vec::new();
    }
    edges.sort_by(|a, b| a.y0.total_cmp(&b.y0));
    let step = spacing * geom::SCALE;
    let offset = phase * geom::SCALE;
    let y_min = edges[0].y0;
    let y_max = edges.iter().map(|e| e.y1).fold(f64::NEG_INFINITY, f64::max);
    let k0 = ((y_min - offset) / step).ceil() as i64;
    let k1 = ((y_max - offset) / step).floor() as i64;
    if k1 < k0 {
        return Vec::new();
    }
    let row_y = |r: usize| offset + (k0 + r as i64) as f64 * step;
    let n_rows = (k1 - k0 + 1) as usize;

    // Rows of (x start, x end) on each scanline, and for each band between two scanlines the edges that cross it.
    let min_len = 0.2 * geom::SCALE;
    let mut rows: Vec<Vec<(f64, f64)>> = Vec::with_capacity(n_rows);
    let mut bands: Vec<Vec<u32>> = Vec::with_capacity(n_rows);
    let mut active: Vec<usize> = Vec::new();
    let mut next = 0;
    let mut xs: Vec<f64> = Vec::new();
    for r in 0..n_rows {
        let y = row_y(r);
        while next < edges.len() && edges[next].y0 <= y {
            active.push(next);
            next += 1;
        }
        active.retain(|&e| edges[e].y1 > y);
        xs.clear();
        xs.extend(active.iter().map(|&e| edges[e].x_at(y)));
        xs.sort_by(f64::total_cmp);
        let mut row = Vec::with_capacity(xs.len() / 2);
        for pair in xs.as_chunks::<2>().0 {
            if pair[1] - pair[0] >= min_len {
                row.push((pair[0], pair[1]));
            }
        }
        rows.push(row);
        if r + 1 < n_rows {
            let y_next = row_y(r + 1);
            let mut band: Vec<u32> = active.iter().map(|&e| e as u32).collect();
            let mut k = next;
            while k < edges.len() && edges[k].y0 < y_next {
                band.push(k as u32);
                k += 1;
            }
            bands.push(band);
        }
    }

    // Chain: from the current end, take the nearest free line on the next scanline (from either end).
    let total: usize = rows.iter().map(Vec::len).sum();
    let mut used: Vec<Vec<bool>> = rows.iter().map(|r| vec![false; r.len()]).collect();
    let mut left = total;
    let mut out: Vec<Contour> = Vec::new();
    let joint_max = step * 2.2;
    let mut row_from = 0usize;
    while left > 0 {
        // Start a run at the first free line from the bottom.
        while row_from < rows.len() && used[row_from].iter().all(|&u| u) {
            row_from += 1;
        }
        let r = row_from;
        if r >= rows.len() {
            break;
        }
        let Some(c) = used[r].iter().position(|&u| !u) else { break };
        used[r][c] = true;
        left -= 1;
        let (a, b) = rows[r][c];
        let mut run = vec![(a, row_y(r)), (b, row_y(r))];
        let mut cur_row = r;
        loop {
            let (ex, ey) = *run.last().unwrap();
            let nr = cur_row + 1;
            if nr >= rows.len() {
                break;
            }
            let ny = row_y(nr);
            let mut best: Option<(usize, f64, bool)> = None;
            for (ci, &(x0, x1)) in rows[nr].iter().enumerate() {
                if used[nr][ci] {
                    continue;
                }
                let (near, flip) = if (x0 - ex).abs() <= (x1 - ex).abs() { (x0, false) } else { (x1, true) };
                let d = (near - ex).abs();
                if best.is_none_or(|(_, bd, _)| d < bd) {
                    best = Some((ci, d, flip));
                }
            }
            let Some((ci, dx, flip)) = best else { break };
            if (dx * dx + (ny - ey) * (ny - ey)).sqrt() > joint_max {
                break;
            }
            let (x0, x1) = rows[nr][ci];
            let (sx, tx) = if flip { (x1, x0) } else { (x0, x1) };
            if !joint_inside(&edges, &bands[cur_row], (ex, ey), (sx, ny)) {
                break;
            }
            used[nr][ci] = true;
            left -= 1;
            run.push((sx, ny));
            run.push((tx, ny));
            cur_row = nr;
        }
        out.push(run.into_iter().map(|(x, y)| from_frame(x, y)).collect());
    }
    out
}

/// Whether the joint p–q between two scanlines lies inside the region (or along its edge): it crosses none of the
/// band's edges, and its middle is inside or on the boundary.
fn joint_inside(edges: &[Edge], band: &[u32], p: (f64, f64), q: (f64, f64)) -> bool {
    // Units of tolerance: the rotation rounds points by about a unit.
    const TOL: f64 = 2.0;
    let (dx, dy) = (q.0 - p.0, q.1 - p.1);
    let length = (dx * dx + dy * dy).sqrt();
    if length < TOL {
        return true;
    }
    let mid = ((p.0 + q.0) / 2.0, (p.1 + q.1) / 2.0);
    let mut winding = 0;
    let mut on_edge = false;
    for &e in band {
        let e = &edges[e as usize];
        let (ax, ay) = (e.x0, e.y0);
        let (bx, by) = (e.x_at(e.y1), e.y1);
        // A proper crossing: each segment's ends strictly on both sides of the other, by more than the tolerance.
        let (ex, ey) = (bx - ax, by - ay);
        let e_len = (ex * ex + ey * ey).sqrt();
        let side_a = (dx * (ay - p.1) - dy * (ax - p.0)) / length;
        let side_b = (dx * (by - p.1) - dy * (bx - p.0)) / length;
        let side_p = (ex * (p.1 - ay) - ey * (p.0 - ax)) / e_len;
        let side_q = (ex * (q.1 - ay) - ey * (q.0 - ax)) / e_len;
        if ((side_a > TOL && side_b < -TOL) || (side_a < -TOL && side_b > TOL))
            && ((side_p > TOL && side_q < -TOL) || (side_p < -TOL && side_q > TOL))
        {
            return false;
        }
        // The middle: on this edge, or a crossing of the ray from it to the right.
        if mid.1 >= e.y0 && mid.1 < e.y1 {
            let x = e.x_at(mid.1);
            if (x - mid.0).abs() <= TOL {
                on_edge = true;
            } else if x > mid.0 {
                winding += e.dir;
            }
        } else {
            let along = ((mid.0 - ax) * ex + (mid.1 - ay) * ey) / (e_len * e_len);
            if (0.0..=1.0).contains(&along) {
                let (cx, cy) = (ax + ex * along, ay + ey * along);
                if (cx - mid.0).hypot(cy - mid.1) <= TOL {
                    on_edge = true;
                }
            }
        }
    }
    on_edge || winding != 0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geom::{pt, sc};

    fn square(size: f64) -> Shapes {
        let s = sc(size);
        vec![vec![vec![pt(0, 0), pt(s, 0), pt(s, s), pt(0, s)]]]
    }

    fn lines(runs: &[Contour]) -> usize {
        runs.iter().map(|r| r.len() / 2).sum()
    }

    #[test]
    fn a_square_fills_as_one_zigzag() {
        for angle in [0.0, 45.0, 90.0, 135.0, 30.0] {
            let runs = fill(&square(20.0), angle, 2.0, 0.0);
            assert!(lines(&runs) >= 9, "{angle}°: {} lines", lines(&runs));
            assert_eq!(runs.len(), 1, "{angle}°: {} runs", runs.len());
        }
    }

    #[test]
    fn a_hole_splits_the_zigzag_but_no_joint_crosses_it() {
        let (s, a, b) = (sc(20.0), sc(6.0), sc(14.0));
        let region: Shapes =
            vec![vec![vec![pt(0, 0), pt(s, 0), pt(s, s), pt(0, s)], vec![pt(a, a), pt(a, b), pt(b, b), pt(b, a)]]];
        let runs = fill(&region, 0.0, 1.0, 0.0);
        assert!(runs.len() >= 2 && runs.len() <= 4, "{} runs", runs.len());
        for run in &runs {
            for w in run.windows(2) {
                let mid = geom::pt((w[0].x + w[1].x) / 2, (w[0].y + w[1].y) / 2);
                let in_hole = mid.x > a && mid.x < b && mid.y > a && mid.y < b;
                assert!(!in_hole, "a joint crosses the hole at {mid:?}");
            }
        }
    }

    #[test]
    fn lines_sit_on_a_grid_fixed_to_the_plate() {
        let a = fill(&square(20.0), 0.0, 2.0, 0.0);
        let shifted: Shapes = vec![vec![vec![
            pt(sc(1.0), sc(1.0)),
            pt(sc(21.0), sc(1.0)),
            pt(sc(21.0), sc(21.0)),
            pt(sc(1.0), sc(21.0)),
        ]]];
        let b = fill(&shifted, 0.0, 2.0, 0.0);
        let ys = |runs: &[Contour]| -> Vec<i32> { runs.iter().flat_map(|r| r.iter().map(|p| p.y)).collect() };
        for y in ys(&a).into_iter().chain(ys(&b)) {
            assert_eq!(y % sc(2.0), 0, "a line off the grid at y {y}");
        }
    }
}
