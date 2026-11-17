//! The inner-outer-inner order of Arachne's walls (`wall_sequence = inner-outer-inner wall`): Orca's
//! `reorderPerimetersByProximity`, `findAllTouchingPerimeters`, `bringContoursToFront` and the "sandwich" in
//! `PerimeterGenerator::process_arachne` that prints an island's second inner wall and those inside it first, then
//! its outer wall and first inner wall.
//!
//! Orca keeps the walls it finds touching in `std::unordered_set<int>`s and reads them back in the set's order, which
//! decides the order two walls print in; [`IntSet`] reproduces libstdc++'s order for them.

use crate::geom::{Pt, SCALE};

/// One wall as the reordering sees it (`PerimeterGeneratorArachneExtrusion`).
pub struct Wall<'a> {
    /// Its inset (0 the outer wall).
    pub inset: usize,
    pub closed: bool,
    /// A closed line that goes clockwise (Arachne's contours; holes go counter-clockwise).
    pub contour: bool,
    pub points: &'a [Pt],
    /// Each junction's width in mm.
    pub widths: &'a [f64],
}

impl Wall<'_> {
    fn length(&self) -> f64 {
        self.points.windows(2).map(|w| crate::geom::dist(w[0], w[1])).sum()
    }
}

/// Whether two lines touch (`arachne_lines_touch`): somewhere the gap between their centre lines is no more than
/// half the two widths there, or `min_threshold` (mm). Each line is its points and their widths (mm).
pub fn lines_touch(a: (&[Pt], &[f64]), b: (&[Pt], &[f64]), min_threshold: f64) -> bool {
    let one_way = |from: (&[Pt], &[f64]), to: (&[Pt], &[f64])| {
        for (k, &p) in from.0.iter().enumerate() {
            for j in 0..to.0.len().saturating_sub(1) {
                let (s0, s1) = (to.0[j], to.0[j + 1]);
                let (dx, dy) = (f64::from(s1.x) - f64::from(s0.x), f64::from(s1.y) - f64::from(s0.y));
                let l2 = dx * dx + dy * dy;
                let (px, py) = (f64::from(p.x) - f64::from(s0.x), f64::from(p.y) - f64::from(s0.y));
                let t = if l2 > 0.0 { ((px * dx + py * dy) / l2).clamp(0.0, 1.0) } else { 0.0 };
                let w = to.1[j] + t * (to.1[j + 1] - to.1[j]);
                let reach = min_threshold.max(0.5 * (from.1[k] + w)) * SCALE;
                let (fx, fy) = (px - t * dx, py - t * dy);
                if (fx * fx + fy * fy).sqrt() <= reach {
                    return true;
                }
            }
        }
        false
    };
    one_way(a, b) || one_way(b, a)
}

fn touch(a: &Wall, b: &Wall, min_threshold: f64) -> bool {
    lines_touch((a.points, a.widths), (b.points, b.widths), min_threshold)
}

/// libstdc++'s `std::unordered_set<int>`: only the order its elements read back in. Elements sit in one list, each
/// bucket's in a run; a new element goes to the front of its bucket's run, or of the list if the bucket is empty, and
/// the table grows through its prime sizes, re-inserting in the list's order.
#[derive(Clone)]
struct IntSet {
    list: Vec<i32>,
    buckets: usize,
    next_resize: usize,
}

fn next_bucket_count(n: usize) -> (usize, usize) {
    const FAST: [usize; 14] = [2, 2, 2, 3, 5, 5, 7, 7, 11, 11, 11, 11, 13, 13];
    let count = if n == 0 {
        return (1, 0);
    } else if n < FAST.len() {
        FAST[n]
    } else {
        (n..).find(|&c| c > 1 && (2..).take_while(|d| d * d <= c).all(|d| c % d != 0)).unwrap()
    };
    (count, count)
}

impl IntSet {
    fn new() -> IntSet {
        IntSet { list: Vec::new(), buckets: 1, next_resize: 0 }
    }

    /// `unordered_set(first, last)`: as inserting one by one (libstdc++ 14's range constructor does).
    fn from_range(items: &[i32]) -> IntSet {
        let mut set = IntSet::new();
        for &i in items {
            set.insert(i);
        }
        set
    }

    fn place(list: &mut Vec<i32>, buckets: usize, x: i32) {
        let b = x as usize % buckets;
        let at = list.iter().position(|&y| y as usize % buckets == b).unwrap_or(0);
        list.insert(at, x);
    }

    fn insert(&mut self, x: i32) {
        if self.list.contains(&x) {
            return;
        }
        let n = self.list.len();
        if n + 1 > self.next_resize {
            // (The first growth of an empty table goes straight to at least 11 buckets.)
            let wanted = (n + 1).max(if self.next_resize == 0 { 11 } else { 0 });
            if wanted >= self.buckets {
                let (buckets, next_resize) = next_bucket_count((wanted + 1).max(self.buckets * 2));
                let old = std::mem::take(&mut self.list);
                for y in old {
                    IntSet::place(&mut self.list, buckets, y);
                }
                self.buckets = buckets;
                self.next_resize = next_resize;
            } else {
                self.next_resize = self.buckets;
            }
        }
        IntSet::place(&mut self.list, self.buckets, x);
    }

    fn contains(&self, x: i32) -> bool {
        self.list.contains(&x)
    }
}

/// `findAllTouchingPerimeters`: the walls of inset `inset` touching any of `references`, in a set's order.
fn find_touching(walls: &[Wall], references: &IntSet, external: f64, internal: f64, inset: usize) -> Vec<i32> {
    let mut touching = IntSet::new();
    for &r in &references.list {
        let reference = &walls[r as usize];
        for (i, w) in walls.iter().enumerate() {
            if references.contains(i as i32) || w.inset == 0 || w.inset != inset {
                continue;
            }
            let threshold = if reference.inset == 0 { external } else { internal };
            if touch(reference, w, threshold) {
                touching.insert(i as i32);
            }
        }
    }
    touching.list
}

/// `reorderPerimetersByProximity`: each outer wall (and what touches it, level by level from there) in turn. Takes
/// and gives indices into `walls`; thresholds in mm.
pub fn reorder_by_proximity(walls: &[Wall], order: &[usize], external: f64, internal: f64) -> Vec<usize> {
    // `entities`: the walls in the order they were given; positions below are into it.
    let entities: Vec<&Wall> = order.iter().map(|&i| &walls[i]).collect();
    let view: Vec<Wall> = entities
        .iter()
        .map(|w| Wall { inset: w.inset, closed: w.closed, contour: w.contour, points: w.points, widths: w.widths })
        .collect();
    let mut reordered: Vec<usize> = Vec::new();
    let mut included: Vec<bool> = vec![false; view.len()];
    let lengths: Vec<f64> = view.iter().map(Wall::length).collect();
    // `std::max_element` with `<`: the first of the largest.
    let max_of = |v: &[i32]| -> usize {
        let mut best = 0;
        for k in 1..v.len() {
            if lengths[v[best] as usize] < lengths[v[k] as usize] {
                best = k;
            }
        }
        best
    };
    for reference in 0..view.len() {
        if view[reference].inset != 0 || included[reference] {
            continue;
        }
        let mut outer: Vec<i32> = vec![reference as i32];
        let mut first_level: Vec<i32> = Vec::new();
        let mut next = 0;
        while next < outer.len() {
            let mut one = IntSet::new();
            one.insert(outer[next]);
            for idx in find_touching(&view, &one, external, internal, 1) {
                if first_level.contains(&idx) {
                    continue;
                }
                first_level.push(idx);
                for i in 0..view.len() {
                    if view[i].inset == 0
                        && !included[i]
                        && !outer.contains(&(i as i32))
                        && touch(&view[i], &view[idx as usize], external)
                    {
                        outer.push(i as i32);
                    }
                }
            }
            next += 1;
        }
        // `stable_partition`: holes (closed, not a contour) first.
        let (holes, rest): (Vec<i32>, Vec<i32>) =
            outer.iter().partition(|&&i| view[i as usize].closed && !view[i as usize].contour);
        let outer: Vec<i32> = holes.into_iter().chain(rest).collect();
        if !first_level.is_empty() {
            let m = max_of(&first_level);
            let last = first_level.len() - 1;
            first_level.swap(m, last);
        }
        for &i in &outer {
            reordered.push(i as usize);
            included[i as usize] = true;
        }
        for &i in &first_level {
            if !included[i as usize] {
                reordered.push(i as usize);
                included[i as usize] = true;
            }
        }
        let mut inset = 2;
        loop {
            let current = IntSet::from_range(&first_level);
            let mut touching = find_touching(&view, &current, external, internal, inset);
            if touching.is_empty() {
                break;
            }
            touching.retain(|&i| !included[i as usize]);
            if !touching.is_empty() {
                let m = max_of(&touching);
                touching.swap(m, 0);
            }
            for &i in &touching {
                if !included[i as usize] {
                    reordered.push(i as usize);
                    included[i as usize] = true;
                }
            }
            first_level = touching;
            inset += 1;
        }
    }
    reordered.extend((0..view.len()).filter(|&i| !included[i]));
    reordered.into_iter().map(|k| order[k]).collect()
}

/// The island-by-island "sandwich" of `process_arachne` for the walls in `order` (indices into `walls`, already
/// ordered outside in): per island, the walls from the second inner one inward print first, innermost first, then
/// its outer wall and first inner wall. Walls of islands without a second inner wall keep their order.
pub fn sandwich(walls: &[Wall], order: Vec<usize>, external: f64, internal: f64) -> Vec<usize> {
    if order.len() <= 2 {
        return order;
    }
    // `bringContoursToFront`
    let (front, back): (Vec<usize>, Vec<usize>) = order.iter().partition(|&&i| walls[i].contour && walls[i].inset == 0);
    let order: Vec<usize> = front.into_iter().chain(back).collect();
    let reordered = reorder_by_proximity(walls, &order, external, internal);
    let mut result = reordered.clone();
    let inset = |i: usize| walls[reordered[i]].inset;
    let size = reordered.len();
    let mut position = 0usize;
    while position < size {
        let (mut outer, mut first, mut second) = (-1i64, -1i64, -1i64);
        let mut max_internal = size as i64 - 1;
        let mut i = position;
        while i < size {
            match inset(i) {
                0 if outer == -1 => outer = i as i64,
                1 if first == -1 && i as i64 > outer && outer != -1 => first = i as i64,
                2 if second == -1 && i as i64 > first && outer != -1 => second = i as i64,
                _ => {}
            }
            if outer > -1 && first > -1 && inset(i) == 0 {
                // A new outer wall: a new island starts here.
                i -= 1;
                max_internal = i as i64;
                break;
            }
            i += 1;
        }
        if outer > -1 && first > -1 && second > -1 {
            let mut sandwich: Vec<usize> = vec![0; (max_internal - position as i64 + 1) as usize];
            let mut current = -1i64;
            let mut j = max_internal;
            while j >= position as i64 {
                if j >= second {
                    sandwich[(max_internal - j) as usize] = reordered[j as usize];
                    current += 1;
                }
                j -= 1;
            }
            for j in position as i64..second {
                current += 1;
                sandwich[current as usize] = reordered[j as usize];
            }
            for j in position as i64..=max_internal {
                result[j as usize] = sandwich[(j - position as i64) as usize];
            }
        }
        position = i + 1;
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Sets as g++ 14's libstdc++ reads them back: `S` inserted one by one, `R` built from the range, then the order
    /// `for (int v : set)` gives.
    const SETS: &str = include_str!("../../tests/arachne/unordered_sets.txt");

    #[test]
    fn a_set_reads_back_in_libstdcxx_order() {
        let numbers = |s: &str| s.split_whitespace().map(|n| n.parse::<i32>().unwrap()).collect::<Vec<_>>();
        for line in SETS.lines() {
            let (kind, rest) = line.split_at(1);
            let (put, got) = rest.split_once('|').unwrap();
            let put = numbers(put);
            let set = if kind == "S" {
                let mut set = IntSet::new();
                for &x in &put {
                    set.insert(x);
                }
                set
            } else {
                IntSet::from_range(&put)
            };
            assert_eq!(set.list, numbers(got), "{line}");
        }
    }
}
