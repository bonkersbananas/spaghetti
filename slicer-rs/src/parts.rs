//! Objects made of parts that print in different filaments, as Orca 2.5 prints them (`PrintObject::slice_volumes`).
//! Each part is cut into layers on its own; then on every layer each part cuts its shape out of the parts listed
//! before it whose boxes overlap its own across the plate (so the last part listed wins), and the parts in one
//! filament merge into one region, closed by Orca's `EPSILON` where more than one of them is there. Each region
//! prints as an object of its own, in its filament. What Orca works out for the whole object takes all of its
//! regions together, by the plate object each region is of (its group): where its infill is anchored, the layer
//! below that its walls hang over, its seams, its brim and the label the printer skips it by.

use crate::geom::{self, Shapes};
use crate::mesh::Mesh;
use crate::par;

/// mm: Orca's `EPSILON`, by which it closes the parts of one region where they meet.
const EPSILON: f64 = 1e-4;

/// The plate's objects as they print: a region for each object and each filament it prints in.
#[derive(Clone, Debug, Default)]
pub struct Regions {
    /// Each region's object on the plate (numbered from 0 in the plate's order).
    pub group: Vec<u32>,
    /// Each region's filament (0-based).
    pub filament: Vec<usize>,
    /// Each mesh's region.
    pub of_mesh: Vec<u32>,
    /// Each object's meshes, in the order of its parts.
    pub members: Vec<Vec<usize>>,
}

impl Regions {
    /// From each mesh's object (`groups`, numbered from 0 with no gaps, an object's meshes in its parts' order) and
    /// filament. Regions are numbered by object, then in the order their filaments first come among its parts, so a
    /// plate whose objects are a mesh each has a region for each mesh, in the same order.
    pub fn new(groups: &[usize], filaments: &[usize]) -> Regions {
        let mut out = Regions::default();
        for (m, (&g, &f)) in groups.iter().zip(filaments).enumerate() {
            if out.members.len() <= g {
                out.members.resize(g + 1, Vec::new());
            }
            out.members[g].push(m);
            let known = out.group.iter().zip(&out.filament).position(|(&rg, &rf)| rg as usize == g && rf == f);
            let region = known.unwrap_or_else(|| {
                out.group.push(g as u32);
                out.filament.push(f);
                out.group.len() - 1
            });
            out.of_mesh.push(region as u32);
        }
        out
    }

    /// The region of object `g` in filament `f`, made (after the others) where the object has none: a painted
    /// filament's.
    pub fn region_of(&mut self, g: usize, f: usize) -> u32 {
        let known = self.group.iter().zip(&self.filament).position(|(&rg, &rf)| rg as usize == g && rf == f);
        known.unwrap_or_else(|| {
            self.group.push(g as u32);
            self.filament.push(f);
            self.group.len() - 1
        }) as u32
    }

    /// Whether some object prints as more than one mesh: its parts in different filaments.
    pub fn split(&self) -> bool {
        self.members.iter().any(|m| m.len() > 1)
    }

    /// Whether some object prints as more than one region.
    pub fn mixed(&self) -> bool {
        mixed(&self.group)
    }

    /// The object (group) of each of `owners` (regions).
    pub fn groups_of(&self, owners: &[u32]) -> Vec<u32> {
        owners.iter().map(|&r| self.group.get(r as usize).copied().unwrap_or(r)).collect()
    }

    /// Each layer's shapes as they print (`slices` and `owners` as `section::slice` cuts them, each shape owned by its
    /// mesh, in the meshes' order): an object's parts clipped and merged as Orca does it, and each shape then owned
    /// by its region. `meshes` give the parts' boxes.
    pub fn assign(&self, slices: &mut [Shapes], owners: &mut [Vec<u32>], meshes: &[Mesh]) {
        if !self.split() {
            // A region for each mesh, in the same order: nothing changes.
            return;
        }
        let boxes: Vec<[f64; 4]> = meshes
            .iter()
            .map(|m| {
                let b = m.bounds();
                [b.min[0], b.min[1], b.max[0], b.max[1]]
            })
            .collect();
        let layers: Vec<(Shapes, Vec<u32>)> =
            par::map_range(slices.len(), |l| self.layer(&slices[l], &owners[l], &boxes));
        for (l, (shapes, own)) in layers.into_iter().enumerate() {
            slices[l] = shapes;
            owners[l] = own;
        }
    }

    /// One layer of `assign`.
    fn layer(&self, shapes: &Shapes, owners: &[u32], boxes: &[[f64; 4]]) -> (Shapes, Vec<u32>) {
        let mut out = Vec::with_capacity(shapes.len());
        let mut own = Vec::with_capacity(shapes.len());
        let mut done = vec![false; self.members.len()];
        for (shape, &m) in shapes.iter().zip(owners) {
            let region = self.of_mesh[m as usize];
            let g = self.group[region as usize] as usize;
            let members = &self.members[g];
            if members.len() == 1 {
                out.push(shape.clone());
                own.push(region);
                continue;
            }
            if std::mem::replace(&mut done[g], true) {
                continue;
            }
            // Each of the object's parts on the layer.
            let mut parts: Vec<Shapes> = members
                .iter()
                .map(|&p| {
                    shapes.iter().zip(owners).filter(|&(_, &o)| o as usize == p).map(|(s, _)| s.clone()).collect()
                })
                .collect();
            // Each part cuts itself out of the parts before it whose boxes overlap its own across the plate.
            for a in 0..parts.len() {
                if parts[a].is_empty() {
                    continue;
                }
                for b in 0..a {
                    if !parts[b].is_empty() && overlap(&boxes[members[a]], &boxes[members[b]]) {
                        parts[b] = geom::difference(&parts[b], &parts[a]);
                    }
                }
            }
            // The parts of each region together, region by region.
            let mut regions: Vec<u32> = members.iter().map(|&p| self.of_mesh[p]).collect();
            regions.sort_unstable();
            regions.dedup();
            for r in regions {
                let mut merged: Shapes = Vec::new();
                let mut count = 0;
                for (a, &p) in members.iter().enumerate() {
                    if self.of_mesh[p] == r && !parts[a].is_empty() {
                        count += 1;
                        merged.append(&mut parts[a]);
                    }
                }
                if count > 1 {
                    merged = geom::closing(&merged, EPSILON);
                }
                own.extend(std::iter::repeat_n(r, merged.len()));
                out.extend(merged);
            }
        }
        (out, own)
    }
}

/// Whether some object prints as more than one region, by each region's object.
pub fn mixed(group: &[u32]) -> bool {
    let mut seen: Vec<u32> = group.to_vec();
    seen.sort_unstable();
    seen.windows(2).any(|w| w[0] == w[1])
}

/// A layer's shapes by object (`owners`: each shape's group): the shapes of an object's regions as one, their union,
/// each object's in the order it first comes.
pub fn group_slices(shapes: &Shapes, owners: &[u32]) -> (Shapes, Vec<u32>) {
    let mut groups: Vec<u32> = Vec::new();
    for &g in owners {
        if !groups.contains(&g) {
            groups.push(g);
        }
    }
    let mut out = Vec::with_capacity(shapes.len());
    let mut own = Vec::with_capacity(shapes.len());
    for g in groups {
        let mine: Shapes = shapes.iter().zip(owners).filter(|&(_, &o)| o == g).map(|(s, _)| s.clone()).collect();
        let merged = if mine.len() > 1 { geom::union_all(&[&mine]) } else { mine };
        own.extend(std::iter::repeat_n(g, merged.len()));
        out.extend(merged);
    }
    (out, own)
}

/// Whether two boxes (min x, min y, max x, max y) overlap across the plate, edges included (Orca's `overlap_in_xy`).
fn overlap(a: &[f64; 4], b: &[f64; 4]) -> bool {
    a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]
}

/// The first layer pulled in by `pull` mm against elephant's foot, as Orca pulls in an object of more than one
/// region (`PrintObject::slice_volumes`): the union of its regions, closed by one and a half times the slice closing
/// radius `closing`, shrinks, and each region keeps its share of what is left. `shapes` and `owners` are the layer's
/// shapes and their regions, `group` each region's object; `single` pulls in the shapes of the objects of one region
/// as they always are. Each shape that is left comes with its region.
pub fn pull_first(
    shapes: &Shapes,
    owners: &[u32],
    group: &[u32],
    pull: f64,
    closing: f64,
    single: impl Fn(&Shapes, &[u32]) -> (Shapes, Vec<u32>),
) -> (Shapes, Vec<u32>) {
    let group_of = |r: u32| group.get(r as usize).copied().unwrap_or(r);
    let mut regions_in = vec![0usize; group.iter().map(|&g| g as usize + 1).max().unwrap_or(0)];
    for &g in group {
        regions_in[g as usize] += 1;
    }
    let several = |r: u32| regions_in.get(group_of(r) as usize).is_some_and(|&n| n > 1);
    let (alone, alone_owners): (Shapes, Vec<u32>) =
        shapes.iter().zip(owners).filter(|&(_, &r)| !several(r)).map(|(s, &r)| (s.clone(), r)).unzip();
    let (mut out, mut own) = single(&alone, &alone_owners);
    let mut groups: Vec<u32> = owners.iter().filter(|&&r| several(r)).map(|&r| group_of(r)).collect();
    groups.sort_unstable();
    groups.dedup();
    for g in groups {
        let mine: Shapes =
            shapes.iter().zip(owners).filter(|&(_, &r)| group_of(r) == g).map(|(s, _)| s.clone()).collect();
        let trimming = geom::offset(&geom::closing(&mine, 1.5 * closing), -pull);
        let mut regions: Vec<u32> = owners.iter().copied().filter(|&r| group_of(r) == g).collect();
        regions.sort_unstable();
        regions.dedup();
        for r in regions {
            let theirs: Shapes = shapes.iter().zip(owners).filter(|&(_, &o)| o == r).map(|(s, _)| s.clone()).collect();
            let kept = geom::intersection(&theirs, &trimming);
            own.extend(std::iter::repeat_n(r, kept.len()));
            out.extend(kept);
        }
    }
    (out, own)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn square(x0: f64, y0: f64, x1: f64, y1: f64) -> geom::Shape {
        let p = |x: f64, y: f64| geom::pt(geom::sc(x), geom::sc(y));
        vec![vec![p(x0, y0), p(x1, y0), p(x1, y1), p(x0, y1)]]
    }

    fn area(shapes: &Shapes) -> f64 {
        shapes.iter().map(geom::shape_area_mm2).sum()
    }

    fn cube(x0: f64, y0: f64, x1: f64, y1: f64) -> Mesh {
        let v = |x: f64, y: f64, z: f64| [x as f32, y as f32, z as f32];
        Mesh {
            name: "part".into(),
            vertices: vec![v(x0, y0, 0.0), v(x1, y0, 0.0), v(x1, y1, 0.0), v(x0, y1, 0.0), v(x0, y0, 1.0)],
            triangles: vec![[0, 1, 2], [0, 2, 3], [0, 1, 4]],
        }
    }

    #[test]
    fn regions_follow_objects_and_filaments() {
        // An object of three parts (filaments 0, 1, 0), then a plain object in filament 1.
        let r = Regions::new(&[0, 0, 0, 1], &[0, 1, 0, 1]);
        assert_eq!(r.group, vec![0, 0, 1]);
        assert_eq!(r.filament, vec![0, 1, 1]);
        assert_eq!(r.of_mesh, vec![0, 1, 0, 2]);
        assert!(r.split() && r.mixed());
        // A mesh each: a region each, in order.
        let r = Regions::new(&[0, 1, 2], &[1, 0, 1]);
        assert_eq!(r.of_mesh, vec![0, 1, 2]);
        assert!(!r.split() && !r.mixed());
    }

    #[test]
    fn later_parts_win_and_one_filament_merges() {
        // Three overlapping squares of one object: A (filament 0), B (filament 1) over A's right half, C (filament 0)
        // over B's right half.
        let meshes = [cube(0.0, 0.0, 10.0, 10.0), cube(5.0, 0.0, 15.0, 10.0), cube(10.0, 0.0, 20.0, 10.0)];
        let r = Regions::new(&[0, 0, 0], &[0, 1, 0]);
        let mut slices =
            vec![vec![square(0.0, 0.0, 10.0, 10.0), square(5.0, 0.0, 15.0, 10.0), square(10.0, 0.0, 20.0, 10.0)]];
        let mut owners = vec![vec![0, 1, 2]];
        r.assign(&mut slices, &mut owners, &meshes);
        let of = |region: u32| -> Shapes {
            slices[0].iter().zip(&owners[0]).filter(|&(_, &o)| o == region).map(|(s, _)| s.clone()).collect()
        };
        // A keeps 0–5, C all of 10–20, merged into one region with A; B keeps 5–10.
        assert!((area(&of(0)) - 150.0).abs() < 1e-6, "{}", area(&of(0)));
        assert!((area(&of(1)) - 50.0).abs() < 1e-6, "{}", area(&of(1)));
        assert_eq!(of(1).len(), 1);
    }

    #[test]
    fn first_layer_pulls_in_round_the_whole_object() {
        // Two regions side by side: pulled in round their union, not where they meet.
        let shapes = vec![square(0.0, 0.0, 10.0, 10.0), square(10.0, 0.0, 20.0, 10.0)];
        let (out, own) = pull_first(&shapes, &[0, 1], &[0, 0], 0.5, 0.049, |s, o| (s.clone(), o.to_vec()));
        assert_eq!(own, vec![0, 1]);
        let a: Shapes = vec![out[0].clone()];
        let b: Shapes = vec![out[1].clone()];
        // Each loses 0.5 mm on its three outer sides only: 9.5 × 9 mm.
        assert!((area(&a) - 85.5).abs() < 1e-3, "{}", area(&a));
        assert!((area(&b) - 85.5).abs() < 1e-3, "{}", area(&b));
    }
}
