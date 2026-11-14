//! Orca's `MinimumSpanningTree` (MinimumSpanningTree.cpp, from Cura): Prim's algorithm over one part's nodes on a
//! layer, which the classic trees merge and move their nodes along.

use std::collections::HashMap;

/// A point in nanometres, as Orca's `Point`.
pub type P = (i64, i64);

/// Orca's `unscale_`.
pub const SCALING_FACTOR: f64 = 0.000_001;

/// Orca's `vsize2_with_unscale`: a vector's squared length in mm².
pub fn vsize2(p: P) -> f64 {
    dot(p, p)
}

/// Orca's `dot_with_unscale`.
pub fn dot(a: P, b: P) -> f64 {
    a.0 as f64 * SCALING_FACTOR * (b.0 as f64 * SCALING_FACTOR)
        + a.1 as f64 * SCALING_FACTOR * (b.1 as f64 * SCALING_FACTOR)
}

pub struct Mst {
    /// Each vertex's neighbours, in the order Prim's algorithm joined them.
    adjacency: HashMap<P, Vec<P>>,
}

impl Mst {
    /// The tree over `vertices` (distinct), grown from the first.
    pub fn new(vertices: &[P]) -> Mst {
        let mut adjacency: HashMap<P, Vec<P>> = HashMap::new();
        match vertices {
            [] => return Mst { adjacency },
            [only] => {
                adjacency.insert(*only, Vec::new());
                return Mst { adjacency };
            }
            _ => {}
        }
        let first = vertices[0];
        // Each vertex not in the tree yet: its squared distance to the tree, and the tree's vertex it is nearest.
        let mut outside: Vec<(P, f64, P)> =
            vertices[1..].iter().map(|&v| (v, vsize2((v.0 - first.0, v.1 - first.1)), first)).collect();
        while !outside.is_empty() {
            // The nearest, the lower point on a tie (Orca breaks ties on coordinates, not on its map's order).
            let mut best = 0;
            for (i, o) in outside.iter().enumerate().skip(1) {
                let b = &outside[best];
                if o.1 < b.1 || (o.1 == b.1 && o.0 < b.0) {
                    best = i;
                }
            }
            let (closest, _, other) = outside.swap_remove(best);
            adjacency.entry(closest).or_default().push(other);
            adjacency.entry(other).or_default().push(closest);
            for o in &mut outside {
                let d = vsize2((closest.0 - o.0.0, closest.1 - o.0.1));
                if d < o.1 {
                    o.1 = d;
                    o.2 = closest;
                }
            }
        }
        Mst { adjacency }
    }

    /// Orca's `adjacent_nodes`: the vertex's neighbours, none for a point not in the tree.
    pub fn adjacent(&self, p: P) -> &[P] {
        self.adjacency.get(&p).map_or(&[], |v| v.as_slice())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_tree_joins_each_point_to_its_nearest_in_the_order_prim_finds_them() {
        let mm = |x: i64, y: i64| (x * 1_000_000, y * 1_000_000);
        // Grown from (0,0): (2,0) and (0,2) are both 2 mm away, and (0,2) joins first, being the lower point.
        let t = Mst::new(&[mm(0, 0), mm(2, 0), mm(0, 2), mm(5, 0)]);
        assert_eq!(t.adjacent(mm(0, 0)), [mm(0, 2), mm(2, 0)]);
        assert_eq!(t.adjacent(mm(0, 2)), [mm(0, 0)]);
        // (5,0) is nearest (2,0) once that has joined.
        assert_eq!(t.adjacent(mm(2, 0)), [mm(0, 0), mm(5, 0)]);
        assert_eq!(t.adjacent(mm(5, 0)), [mm(2, 0)]);
        assert!(t.adjacent(mm(9, 9)).is_empty());
        assert!(Mst::new(&[mm(5, 5)]).adjacent(mm(5, 5)).is_empty());
    }
}
