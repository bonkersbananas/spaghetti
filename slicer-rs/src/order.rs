//! Print order as Orca 2.5 makes it (`ShortestPath.cpp`, `GCode/OrderingStrategies.cpp`): paths chained by the
//! multi-fragment greedy algorithm (a few of them exactly), an island's infill improved by local search, and a
//! layer's islands toured exactly when there are few of them, else greedily and then improved.
//!
//! Orca finds nearest points with a KD tree, ties going to whichever it meets first; here a grid finds them, ties
//! going to the lowest index, so where distances tie exactly the two may chain differently.

use crate::geom::Pt;

type V = (f64, f64);

/// Orca's `SCALED_EPSILON` (100 nm) in our units (0.1 µm).
const SCALED_EPSILON: f64 = 1.0;

fn v(p: Pt) -> V {
    (p.x as f64, p.y as f64)
}

fn d2(a: V, b: V) -> f64 {
    let (dx, dy) = (a.0 - b.0, a.1 - b.1);
    dx * dx + dy * dy
}

fn norm(a: V, b: V) -> f64 {
    d2(a, b).sqrt()
}

/// The order to print paths in, each given by its first and last point (the same for a loop), from near `start`:
/// the path's index and whether it runs backwards. A path that can't be reversed never is (a loop's reversal means
/// nothing, and is left to the caller to ignore). `improve` is Orca's chaining of an island's infill: few paths
/// chained exactly, more improved by local search and set against always going to the nearest.
pub fn chain(ends: &[(Pt, Pt)], reversible: &[bool], start: Option<Pt>, improve: bool) -> Vec<(usize, bool)> {
    let n = ends.len();
    let points: Vec<V> = ends.iter().flat_map(|&(a, b)| [v(a), v(b)]).collect();
    let start = start.map(v);
    let could = |i: usize| reversible[i];
    let mut out = greedy(&points, &could, start, true);
    if improve && n > 1 {
        if n <= 8 {
            out = exact(&points, reversible, start);
        } else {
            local_search(&mut out, &points, reversible, start);
            if let Some(s) = start {
                let mut nearest = nearest_next(&points, reversible, s);
                if travel(&nearest, &points, s) < travel(&out, &points, s) - SCALED_EPSILON {
                    local_search(&mut nearest, &points, reversible, Some(s));
                    out = nearest;
                }
            }
        }
    }
    out
}

/// A tour of points (a layer's islands), from the one nearest `start` (Orca's `chain_points_with_postprocessing`):
/// up to ten exactly, more greedily and then improved by 2-opt, or-opt and removing crossings.
pub fn tour(points: &[Pt], start: Option<Pt>) -> Vec<usize> {
    let mut path: Vec<usize>;
    if points.len() <= 10 {
        path = exact_cycle(points);
        if let Some(s) = start
            && path.len() > 2
        {
            let dist = |a: usize, b: Pt| d2(v(points[a]), v(b));
            let first =
                (0..path.len()).fold(0, |best, k| if dist(path[k], s) < dist(path[best], s) { k } else { best });
            path.rotate_left(first);
            let p0 = points[path[0]];
            if dist(*path.last().unwrap(), p0) < dist(path[1], p0) {
                path[1..].reverse();
            }
        }
    } else {
        let ends: Vec<V> = points.iter().flat_map(|&p| [v(p), v(p)]).collect();
        path = greedy(&ends, &|_| true, start.map(v), false).into_iter().map(|(i, _)| i).collect();
        for _ in 0..3 {
            let mut improved = two_opt(&mut path, points, 10);
            improved |= cycle_or_opt(&mut path, points);
            improved |= remove_crossings(&mut path, points);
            if !improved {
                break;
            }
        }
    }
    if start.is_none() {
        rotate_minimize_closing(&mut path, points);
    }
    path
}

// ---- Nearest points (ShortestPath.cpp, NearestPoints) ----

/// The points nearest to a query, nearest first, ties by index, from a uniform grid of about two points per cell.
struct Nearest<'a> {
    points: &'a [V],
    origin: V,
    cell: f64,
    cols: i64,
    rows: i64,
    first: Vec<usize>,
    index: Vec<usize>,
}

impl<'a> Nearest<'a> {
    fn new(points: &'a [V]) -> Self {
        let (mut lo, mut hi) = ((f64::MAX, f64::MAX), (f64::MIN, f64::MIN));
        for p in points {
            lo = (lo.0.min(p.0), lo.1.min(p.1));
            hi = (hi.0.max(p.0), hi.1.max(p.1));
        }
        if points.is_empty() {
            (lo, hi) = ((0.0, 0.0), (0.0, 0.0));
        }
        let size = (hi.0 - lo.0, hi.1 - lo.1);
        let count = points.len().max(1) as f64;
        let mut cell = (2.0 * size.0 * size.1 / count).sqrt().max(size.0.max(size.1) / count);
        if cell <= 0.0 || cell.is_nan() {
            cell = 1.0;
        }
        let cols = (size.0 / cell) as i64 + 1;
        let rows = (size.1 / cell) as i64 + 1;
        let mut grid = Nearest { points, origin: lo, cell, cols, rows, first: Vec::new(), index: Vec::new() };
        let cells = (cols * rows) as usize;
        let mut first = vec![0usize; cells + 1];
        for &p in points {
            first[grid.cell_of(p) + 1] += 1;
        }
        for c in 1..first.len() {
            first[c] += first[c - 1];
        }
        let mut next: Vec<usize> = first[..cells].to_vec();
        let mut index = vec![0usize; points.len()];
        for (i, &p) in points.iter().enumerate() {
            let c = grid.cell_of(p);
            index[next[c]] = i;
            next[c] += 1;
        }
        grid.first = first;
        grid.index = index;
        grid
    }

    fn cell_of(&self, p: V) -> usize {
        let x = (((p.0 - self.origin.0) / self.cell) as i64).clamp(0, self.cols - 1);
        let y = (((p.1 - self.origin.1) / self.cell) as i64).clamp(0, self.rows - 1);
        (y * self.cols + x) as usize
    }

    /// The `k` nearest points to `q` that `filter` accepts, nearest first (fewer when fewer are accepted).
    fn query(&self, q: V, k: usize, filter: &dyn Fn(usize) -> bool) -> Vec<usize> {
        let mut best = Vec::with_capacity(k + 1);
        self.query_into(q, k, filter, &mut best);
        best.into_iter().map(|(_, i)| i).collect()
    }

    /// The same into `best` (squared distance and index), for callers that ask many times.
    fn query_into<F: Fn(usize) -> bool>(&self, q: V, k: usize, filter: F, best: &mut Vec<(f64, usize)>) {
        best.clear();
        let less = |a: (f64, usize), b: (f64, usize)| a.0 < b.0 || (a.0 == b.0 && a.1 < b.1);
        let cx = ((q.0 - self.origin.0) / self.cell).floor().clamp(0.0, (self.cols - 1) as f64) as i64;
        let cy = ((q.1 - self.origin.1) / self.cell).floor().clamp(0.0, (self.rows - 1) as f64) as i64;
        let visit = |x: i64, y: i64, best: &mut Vec<(f64, usize)>| {
            if x < 0 || y < 0 || x >= self.cols || y >= self.rows {
                return;
            }
            let c = (y * self.cols + x) as usize;
            for &i in &self.index[self.first[c]..self.first[c + 1]] {
                if !filter(i) {
                    continue;
                }
                let candidate = (d2(self.points[i], q), i);
                if best.len() == k && !less(candidate, best[k - 1]) {
                    continue;
                }
                let at = best.partition_point(|&e| !less(candidate, e));
                best.insert(at, candidate);
                best.truncate(k);
            }
        };
        for r in 0..=self.cols.max(self.rows) {
            if r == 0 {
                visit(cx, cy, best);
            }
            if r > 0 {
                for d in -r..=r {
                    visit(cx + d, cy - r, best);
                    visit(cx + d, cy + r, best);
                    if d != -r && d != r {
                        visit(cx - r, cy + d, best);
                        visit(cx + r, cy + d, best);
                    }
                }
            }
            let reach = r as f64 * self.cell;
            if best.len() == k && best[k - 1].0 <= reach * reach {
                break;
            }
        }
    }

    fn nearest(&self, q: V, filter: &dyn Fn(usize) -> bool) -> Option<usize> {
        self.query(q, 1, filter).first().copied()
    }
}

// ---- Chaining (ShortestPath.cpp) ----

/// The shortest chain over every order and allowed reversal, by dynamic programming over the subsets of segments
/// (Orca's `chain_segments_exact`), from `start` when given; its end is free.
fn exact(points: &[V], could_reverse: &[bool], start: Option<V>) -> Vec<(usize, bool)> {
    let n = could_reverse.len();
    let states = (1usize << n) * n * 2;
    let mut cost = vec![f64::MAX; states];
    let mut from = vec![usize::MAX; states];
    let entry = |j: usize, o: usize| points[2 * j + o];
    let exit = |j: usize, o: usize| points[2 * j + 1 - o];
    for j in 0..n {
        for o in 0..=usize::from(could_reverse[j]) {
            cost[((1usize << j) * n + j) * 2 + o] = start.map_or(0.0, |s| norm(entry(j, o), s));
        }
    }
    for mask in 1..(1usize << n) {
        for s in mask * n * 2..(mask + 1) * n * 2 {
            if cost[s] == f64::MAX {
                continue;
            }
            for (k, &reversible) in could_reverse.iter().enumerate() {
                if mask >> k & 1 != 0 {
                    continue;
                }
                for o in 0..=usize::from(reversible) {
                    let next = (((mask | 1 << k) * n) + k) * 2 + o;
                    let c = cost[s] + norm(entry(k, o), exit(s / 2 % n, s & 1));
                    if c < cost[next] {
                        cost[next] = c;
                        from[next] = s;
                    }
                }
            }
        }
    }
    let full = (1usize << n) - 1;
    let mut best = full * n * 2;
    for s in full * n * 2..states {
        if cost[s] < cost[best] {
            best = s;
        }
    }
    let mut out = vec![(0, false); n];
    let mut s = best;
    for k in (0..n).rev() {
        out[k] = (s / 2 % n, s & 1 != 0);
        if k > 0 {
            s = from[s];
        }
    }
    out
}

/// Chain ids that may have been merged: each points at a lower one it was merged into, the lowest standing for all.
struct Chains {
    with: Vec<usize>,
}

impl Chains {
    fn next(&mut self) -> usize {
        let id = self.with.len();
        self.with.push(id);
        id
    }

    fn find(&self, mut id: usize) -> usize {
        while id != 0 && self.with[id] != id {
            id = self.with[id];
        }
        id
    }

    fn merge(&mut self, a: usize, b: usize) -> usize {
        let id = self.find(a).min(self.find(b));
        self.with[a] = id;
        self.with[b] = id;
        id
    }
}

/// A binary heap of end points by the length of their link, which can update and remove any of them.
struct Heap {
    items: Vec<usize>,
    at: Vec<usize>,
}

impl Heap {
    const NONE: usize = usize::MAX;

    fn less(key: &[f64], a: usize, b: usize) -> bool {
        key[a] < key[b] || (key[a] == key[b] && a < b)
    }

    fn swap(&mut self, i: usize, j: usize) {
        self.items.swap(i, j);
        self.at[self.items[i]] = i;
        self.at[self.items[j]] = j;
    }

    fn up(&mut self, key: &[f64], mut i: usize) {
        while i > 0 {
            let parent = (i - 1) / 2;
            if !Heap::less(key, self.items[i], self.items[parent]) {
                break;
            }
            self.swap(i, parent);
            i = parent;
        }
    }

    fn down(&mut self, key: &[f64], mut i: usize) {
        loop {
            let (l, r) = (2 * i + 1, 2 * i + 2);
            let mut m = i;
            if l < self.items.len() && Heap::less(key, self.items[l], self.items[m]) {
                m = l;
            }
            if r < self.items.len() && Heap::less(key, self.items[r], self.items[m]) {
                m = r;
            }
            if m == i {
                break;
            }
            self.swap(i, m);
            i = m;
        }
    }

    fn push(&mut self, key: &[f64], item: usize) {
        self.items.push(item);
        self.at[item] = self.items.len() - 1;
        self.up(key, self.items.len() - 1);
    }

    fn top(&self) -> usize {
        self.items[0]
    }

    fn remove(&mut self, key: &[f64], item: usize) {
        let i = self.at[item];
        let last = self.items.len() - 1;
        if i != last {
            self.swap(i, last);
        }
        self.items.pop();
        self.at[item] = Heap::NONE;
        if i < self.items.len() {
            self.down(key, i);
            self.up(key, i);
        }
    }

    fn update(&mut self, key: &[f64], item: usize) {
        let i = self.at[item];
        self.down(key, i);
        self.up(key, self.at[item]);
    }
}

/// Orca's `chain_segments_greedy_constrained_reversals_`: the multi-fragment algorithm, which keeps adding the
/// shortest link between two end points that makes neither a fork nor a loop; one segment is turned toward `start`,
/// up to four are chained exactly. `points` holds each segment's first and last point. Where the result would
/// run a segment backwards that can't be (`reverse_could_fail`), it tries the chain from its other end, then falls
/// back to always going to the nearest.
fn greedy(
    points: &[V],
    could_reverse: &dyn Fn(usize) -> bool,
    start: Option<V>,
    reverse_could_fail: bool,
) -> Vec<(usize, bool)> {
    let n = points.len() / 2;
    if n == 0 {
        return Vec::new();
    }
    if n == 1 {
        let flip = could_reverse(0) && start.is_some_and(|s| d2(points[1], s) < d2(points[0], s));
        return vec![(0, flip)];
    }
    if n <= 4 {
        let reversible: Vec<bool> = (0..n).map(could_reverse).collect();
        return exact(points, &reversible, start);
    }
    const NONE: usize = usize::MAX;
    let grid = Nearest::new(points);
    let mut chain_id = vec![0usize; 2 * n];
    let mut edge = vec![NONE; 2 * n];
    let mut dist = vec![f64::MAX; 2 * n];
    let mut chains = Chains { with: vec![0] };
    let mut first: Option<usize> = None;
    if let Some(s) = start {
        // Don't start with a segment backwards that can't be.
        let idx = grid.nearest(s, &|idx| idx & 1 == 0 || could_reverse(idx >> 1)).unwrap_or(0);
        dist[idx] = 0.0;
        chain_id[idx] = chains.next();
        first = Some(idx);
    }
    let initial = first;
    for this in 0..2 * n {
        if Some(this) == first {
            continue;
        }
        // The closest end point of another segment, never the start, which no end point can join.
        if let Some(next) = grid.nearest(points[this], &|idx| Some(idx) != first && (idx ^ this) > 1) {
            edge[this] = next;
            dist[this] = d2(points[next], points[this]);
        }
    }
    let mut heap = Heap { items: Vec::with_capacity(2 * n), at: vec![Heap::NONE; 2 * n] };
    for ep in 0..2 * n {
        if Some(ep) != first {
            heap.push(&dist, ep);
        }
    }
    let last: Option<usize>;
    let mut iter = n - 2;
    loop {
        let ep1 = heap.top();
        let ep2 = edge[ep1];
        let mut valid = ep2 != NONE;
        let (mut c1, mut c2) = (0, 0);
        if valid && chain_id[ep2] > 0 {
            valid = false;
        } else if valid {
            c1 = chains.find(chain_id[ep1 ^ 1]);
            c2 = chains.find(chain_id[ep2 ^ 1]);
            if c1 == c2 && c1 != 0 {
                valid = false;
            }
        }
        if valid {
            heap.remove(&dist, ep1);
            heap.remove(&dist, ep2);
            edge[ep2] = ep1;
            dist[ep2] = dist[ep1];
            let id = match (c1, c2) {
                (0, 0) => chains.next(),
                (0, c) | (c, 0) => c,
                (a, b) if a == b => a,
                (a, b) => chains.merge(a, b),
            };
            chain_id[ep1] = id;
            chain_id[ep2] = id;
            if iter == 0 {
                if first.is_none() {
                    let f = heap.top();
                    heap.remove(&dist, f);
                    edge[f] = NONE;
                    first = Some(f);
                }
                let l = heap.top();
                edge[l] = NONE;
                heap.remove(&dist, l);
                last = Some(l);
                break;
            }
            iter -= 1;
        } else {
            // The link would make a loop or a fork: link the end point to its next closest instead.
            let ch1 = chains.find(chain_id[ep1 ^ 1]);
            let next = grid.nearest(points[ep1], &|idx| {
                if (idx ^ ep1) <= 1 || chain_id[idx] != 0 {
                    return false;
                }
                let ch2 = chains.find(chain_id[idx ^ 1]);
                ch1 != ch2 || ch1 == 0
            });
            match next {
                Some(next) => {
                    edge[ep1] = next;
                    dist[ep1] = d2(points[next], points[ep1]);
                }
                None => {
                    edge[ep1] = NONE;
                    dist[ep1] = f64::MAX;
                }
            }
            heap.update(&dist, ep1);
        }
    }
    let walk = |from: usize| -> Option<Vec<(usize, bool)>> {
        let mut out = Vec::with_capacity(n);
        let mut at = from;
        loop {
            let (segment, reverse) = (at >> 1, at & 1 != 0);
            if reverse_could_fail && reverse && !could_reverse(segment) {
                return None;
            }
            out.push((segment, reverse));
            if out.len() > n {
                return None;
            }
            match edge[at ^ 1] {
                NONE => return Some(out),
                e => at = e,
            }
        }
    };
    let mut out = first.and_then(walk);
    if out.is_none() && start.is_none() {
        // The other way round.
        out = last.and_then(walk);
    }
    match out {
        Some(out) if out.len() == n => out,
        _ => closest_chain(points, &grid, could_reverse, initial.unwrap_or(0)),
    }
}

/// Always on to the nearest free end point (Orca's `chain_segments_closest_point`), from end point `first`.
fn closest_chain(
    points: &[V],
    grid: &Nearest,
    could_reverse: &dyn Fn(usize) -> bool,
    first: usize,
) -> Vec<(usize, bool)> {
    let n = points.len() / 2;
    let mut taken = vec![false; 2 * n];
    let mut out = Vec::with_capacity(n);
    out.push((first / 2, first & 1 != 0));
    taken[first] = true;
    let mut this = first ^ 1;
    for _ in 1..n {
        taken[this] = true;
        let Some(next) = grid
            .nearest(points[this], &|idx| (idx ^ this) > 1 && !taken[idx] && (idx & 1 == 0 || could_reverse(idx >> 1)))
        else {
            break;
        };
        taken[next] = true;
        out.push((next / 2, next & 1 != 0));
        this = next ^ 1;
    }
    out
}

/// Chain that always goes on to the nearest free end point, from `start` (Orca's `chain_nearest_next`).
fn nearest_next(points: &[V], could_reverse: &[bool], start: V) -> Vec<(usize, bool)> {
    let grid = Nearest::new(points);
    let mut taken = vec![false; could_reverse.len()];
    let mut out = Vec::with_capacity(could_reverse.len());
    let mut at = start;
    while out.len() < could_reverse.len() {
        let Some(e) = grid.nearest(at, &|idx| !taken[idx >> 1] && (idx & 1 == 0 || could_reverse[idx >> 1])) else {
            break;
        };
        taken[e >> 1] = true;
        out.push((e >> 1, e & 1 != 0));
        at = points[e ^ 1];
    }
    out
}

/// The travel along a chain from `start`.
fn travel(chain: &[(usize, bool)], points: &[V], start: V) -> f64 {
    let mut total = 0.0;
    let mut at = start;
    for &(segment, flipped) in chain {
        let f = usize::from(flipped);
        total += norm(points[2 * segment + f], at);
        at = points[2 * segment + 1 - f];
    }
    total
}

/// Shortens a chain's travel with 2-opt moves (reversing a run of segments) and or-opt moves (moving a run of up to
/// three segments elsewhere, or a longer one to the front, flipped or not), as Orca's `improve_chain_by_local_search`:
/// moves only make links between near end points (the 32 nearest), and after a move only the segments next to a
/// changed link are looked at again, until a sweep of all of them finds no move.
fn local_search(chain: &mut [(usize, bool)], points: &[V], could_reverse: &[bool], start: Option<V>) {
    let n = chain.len();
    if n < 2 {
        return;
    }
    const K: usize = 32;
    const NPOS: usize = usize::MAX;
    let mut order = vec![0usize; n];
    let mut pos = vec![0usize; n];
    let mut fixed_before = vec![0usize; n + 1];
    let mut flipped = vec![false; n];
    for k in 0..n {
        order[k] = chain[k].0;
        flipped[order[k]] = chain[k].1;
    }
    // Each end point's K nearest (of other segments), nearest first, NPOS past the last.
    let grid = Nearest::new(points);
    let mut neighbors = vec![NPOS; points.len() * K];
    let mut best = Vec::with_capacity(K + 1);
    for e in 0..points.len() {
        grid.query_into(points[e], K, |idx| (idx >> 1) != (e >> 1), &mut best);
        for (slot, &(_, idx)) in neighbors[e * K..].iter_mut().zip(best.iter()) {
            *slot = idx;
        }
    }
    let near = |e: usize| &neighbors[e * K..(e + 1) * K];
    let start_neighbors: Vec<usize> = match start {
        Some(s) => grid.query(s, K, &|_| true),
        None => Vec::new(),
    };

    struct S<'a> {
        n: usize,
        points: &'a [V],
        could_reverse: &'a [bool],
        start: Option<V>,
        order: Vec<usize>,
        pos: Vec<usize>,
        fixed_before: Vec<usize>,
        flipped: Vec<bool>,
        queue: Vec<usize>,
        head: usize,
        queued: Vec<bool>,
    }

    impl S<'_> {
        fn refresh(&mut self, lo: usize, hi: usize) {
            for k in lo..=hi {
                self.pos[self.order[k]] = k;
                self.fixed_before[k + 1] = self.fixed_before[k] + usize::from(!self.could_reverse[self.order[k]]);
            }
        }
        fn entry_idx(&self, k: usize) -> usize {
            2 * self.order[k] + usize::from(self.flipped[self.order[k]])
        }
        fn exit_idx(&self, k: usize) -> usize {
            2 * self.order[k] + 1 - usize::from(self.flipped[self.order[k]])
        }
        fn entry(&self, k: usize) -> V {
            self.points[self.entry_idx(k)]
        }
        fn exit(&self, k: usize) -> V {
            self.points[self.exit_idx(k)]
        }
        fn is_exit(&self, e: usize) -> bool {
            (e & 1 != 0) != self.flipped[e >> 1]
        }
        fn reversible(&self, i: usize, j: usize) -> bool {
            self.fixed_before[j + 1] == self.fixed_before[i]
        }
        fn prev_exit(&self, k: usize) -> Option<V> {
            if k > 0 { Some(self.exit(k - 1)) } else { self.start }
        }
        fn next_entry(&self, k: usize) -> Option<V> {
            if k + 1 < self.n { Some(self.entry(k + 1)) } else { None }
        }
        fn enqueue(&mut self, k: usize) {
            if k < self.n && !self.queued[self.order[k]] {
                self.queued[self.order[k]] = true;
                if self.head == self.queue.len() {
                    self.queue.clear();
                    self.head = 0;
                }
                self.queue.push(self.order[k]);
            }
        }
        /// Reverses positions i..=j if that shortens the chain.
        fn try_2opt(&mut self, i: usize, j: usize) -> bool {
            if !self.reversible(i, j) {
                return false;
            }
            let (a, b) = (self.prev_exit(i), self.next_entry(j));
            let (ei, xj) = (self.entry(i), self.exit(j));
            if dist(a, Some(xj)) + dist(Some(ei), b) > dist(a, Some(ei)) + dist(Some(xj), b) - SCALED_EPSILON {
                return false;
            }
            self.order[i..=j].reverse();
            for k in i..=j {
                let o = self.order[k];
                self.flipped[o] = !self.flipped[o];
            }
            self.refresh(i, j);
            for k in [i.wrapping_sub(1), i, j, j + 1] {
                self.enqueue(k);
            }
            true
        }
        /// Moves positions i..=last after position `gap` (`usize::MAX` for the front) if that shortens the chain.
        fn try_oropt(&mut self, i: usize, last: usize, gap: usize) -> bool {
            if gap.wrapping_add(1) == i || (gap >= i && gap <= last) {
                return false;
            }
            let a = if gap == usize::MAX { self.start } else { Some(self.exit(gap)) };
            let b = if gap.wrapping_add(1) < self.n { Some(self.entry(gap.wrapping_add(1))) } else { None };
            let removal = dist(self.prev_exit(i), Some(self.entry(i)))
                + dist(Some(self.exit(last)), self.next_entry(last))
                - dist(self.prev_exit(i), self.next_entry(last));
            let base = dist(a, b);
            let cost_kept = dist(a, Some(self.entry(i))) + dist(Some(self.exit(last)), b) - base;
            let cost_flipped = if self.reversible(i, last) {
                dist(a, Some(self.exit(last))) + dist(Some(self.entry(i)), b) - base
            } else {
                f64::MAX
            };
            if cost_kept.min(cost_flipped) > removal - SCALED_EPSILON {
                return false;
            }
            let len = last - i + 1;
            let forward = gap > last && gap != usize::MAX;
            let first = if forward { gap + 1 - len } else { gap.wrapping_add(1) };
            let (lo, hi) = if forward { (i, gap) } else { (first, last) };
            if forward {
                self.order[i..=gap].rotate_left(last + 1 - i);
            } else {
                self.order[first..=last].rotate_left(i - first);
            }
            if cost_flipped < cost_kept {
                self.order[first..first + len].reverse();
                for k in first..first + len {
                    let o = self.order[k];
                    self.flipped[o] = !self.flipped[o];
                }
            }
            self.refresh(lo, hi);
            let (closing_a, closing_b) = if forward { (i.wrapping_sub(1), i) } else { (last, last + 1) };
            for k in [first.wrapping_sub(1), first, first + len - 1, first + len, closing_a, closing_b] {
                self.enqueue(k);
            }
            true
        }
    }

    fn dist(a: Option<V>, b: Option<V>) -> f64 {
        match (a, b) {
            (Some(a), Some(b)) => norm(a, b),
            _ => 0.0,
        }
    }

    let mut s = S {
        n,
        points,
        could_reverse,
        start,
        order: std::mem::take(&mut order),
        pos: std::mem::take(&mut pos),
        fixed_before: std::mem::take(&mut fixed_before),
        flipped: std::mem::take(&mut flipped),
        queue: Vec::new(),
        head: 0,
        queued: vec![false; n],
    };
    s.refresh(0, n - 1);
    let closer = |at: V, q: usize, limit: f64| q != NPOS && norm(points[q], at) < limit;
    let gap_before =
        |k: usize, i: usize, last: usize| if k == last + 1 { i.wrapping_sub(1) } else { k.wrapping_sub(1) };

    // Applies the first move found that breaks a link next to position p.
    let improve_at = |s: &mut S, p: usize| -> bool {
        // 2-opt breaking the link into p, as the first or the last link of the reversed run.
        if let Some(a) = s.prev_exit(p) {
            let old_link = norm(a, s.entry(p));
            let around: &[usize] = if p > 0 { near(s.exit_idx(p - 1)) } else { &start_neighbors };
            for &q in around {
                if !closer(a, q, old_link) {
                    break;
                }
                if s.is_exit(q) && s.pos[q >> 1] >= p && s.try_2opt(p, s.pos[q >> 1]) {
                    return true;
                }
            }
            if p > 0 {
                let e = s.entry(p);
                for &q in near(s.entry_idx(p)) {
                    if !closer(e, q, old_link) {
                        break;
                    }
                    if !s.is_exit(q) && s.pos[q >> 1] < p && s.try_2opt(s.pos[q >> 1], p - 1) {
                        return true;
                    }
                }
            }
        }
        // 2-opt breaking the link out of p.
        if p + 1 < s.n {
            let old_link = norm(s.exit(p), s.entry(p + 1));
            let x = s.exit(p);
            for &q in near(s.exit_idx(p)) {
                if !closer(x, q, old_link) {
                    break;
                }
                if s.is_exit(q) && s.pos[q >> 1] > p && s.try_2opt(p + 1, s.pos[q >> 1]) {
                    return true;
                }
            }
            let e = s.entry(p + 1);
            for &q in near(s.entry_idx(p + 1)) {
                if !closer(e, q, old_link) {
                    break;
                }
                if !s.is_exit(q) && s.pos[q >> 1] <= p && s.try_2opt(s.pos[q >> 1], p) {
                    return true;
                }
            }
        }
        // A run of any length that starts or ends next to the start point moves to the front.
        if p == 0 {
            for &q in &start_neighbors {
                let m = s.pos[q >> 1];
                if m == 0 {
                    continue;
                }
                // Runs m..k enter next to the start, runs k..m leave there and go flipped.
                let exit_near = s.is_exit(q);
                let (from, to) = if exit_near { (1, m + 1) } else { (m, s.n) };
                for k in from..to {
                    let (i, last) = if exit_near { (k, m) } else { (m, k) };
                    if s.try_oropt(i, last, usize::MAX) {
                        return true;
                    }
                }
            }
        }
        // Or-opt of the runs starting at p: next to an exit a run goes after that segment, next to an entry before it.
        for last in p..(p + 3).min(s.n) {
            if s.try_oropt(p, last, usize::MAX) {
                return true;
            }
            let removal = dist(s.prev_exit(p), Some(s.entry(p))) + dist(Some(s.exit(last)), s.next_entry(last))
                - dist(s.prev_exit(p), s.next_entry(last));
            for e in [s.entry_idx(p), s.exit_idx(last)] {
                for &q in near(e) {
                    if !closer(points[e], q, removal) {
                        break;
                    }
                    let m = s.pos[q >> 1];
                    if (m < p || m > last)
                        && s.try_oropt(p, last, if s.is_exit(q) { m } else { gap_before(m, p, last) })
                    {
                        return true;
                    }
                }
            }
        }
        false
    };

    for k in 0..n {
        s.enqueue(k);
    }
    let mut moved_since_sweep = false;
    let mut moves = 0;
    while moves < 50 * n {
        if s.head == s.queue.len() {
            if !moved_since_sweep {
                break;
            }
            moved_since_sweep = false;
            for k in 0..n {
                s.enqueue(k);
            }
        }
        let segment = s.queue[s.head];
        s.head += 1;
        s.queued[segment] = false;
        let p = s.pos[segment];
        if improve_at(&mut s, p) {
            moves += 1;
            moved_since_sweep = true;
            let p = s.pos[segment];
            s.enqueue(p);
        }
    }
    for (k, link) in chain.iter_mut().enumerate() {
        *link = (s.order[k], s.flipped[s.order[k]]);
    }
}

// ---- Touring islands (GCode/OrderingStrategies.cpp) ----

/// The shortest closed tour through up to 17 points, from point 0 (Orca's `tsp_exact_cycle`).
fn exact_cycle(centers: &[Pt]) -> Vec<usize> {
    let n = centers.len();
    let mut path: Vec<usize> = (0..n).collect();
    if n <= 3 {
        return path;
    }
    let m = n - 1;
    let mut cost = vec![f64::MAX; (1usize << m) * m];
    let mut from = vec![usize::MAX; cost.len()];
    let dist = |a: usize, b: usize| norm(v(centers[a]), v(centers[b]));
    for j in 0..m {
        cost[(1usize << j) * m + j] = dist(0, j + 1);
    }
    for mask in 1..(1usize << m) {
        for j in 0..m {
            let c = cost[mask * m + j];
            if c == f64::MAX {
                continue;
            }
            for k in 0..m {
                if mask >> k & 1 != 0 {
                    continue;
                }
                let next = (mask | 1 << k) * m + k;
                let nc = c + dist(j + 1, k + 1);
                if nc < cost[next] {
                    cost[next] = nc;
                    from[next] = mask * m + j;
                }
            }
        }
    }
    let full = (1usize << m) - 1;
    let mut best = full * m;
    for j in 1..m {
        if cost[full * m + j] + dist(j + 1, 0) < cost[best] + dist(best % m + 1, 0) {
            best = full * m + j;
        }
    }
    let mut s = best;
    for k in (1..n).rev() {
        path[k] = s % m + 1;
        if k > 1 {
            s = from[s];
        }
    }
    path
}

/// Up to `max_passes` times, the 2-opt move that shortens the closed tour most (Orca's `tsp_2opt_improve`).
fn two_opt(path: &mut [usize], centers: &[Pt], max_passes: usize) -> bool {
    let pn = path.len();
    if pn <= 2 {
        return false;
    }
    let mut improved = false;
    for _ in 0..max_passes {
        let c = |k: usize| v(centers[path[k]]);
        let el: Vec<f64> = (0..pn).map(|i| norm(v(centers[path[i]]), v(centers[path[(i + 1) % pn]]))).collect();
        let elsq: Vec<f64> = (0..pn).map(|i| d2(v(centers[path[i]]), v(centers[path[(i + 1) % pn]]))).collect();
        let (mut best_i, mut best_j, mut best_gain) = (pn, pn, 0.0);
        for i in 0..pn {
            let (pi, p_in) = (c(i), c((i + 1) % pn));
            for j in i + 2..pn {
                let j_next = (j + 1) % pn;
                if i == 0 && j_next == 0 {
                    continue;
                }
                let (pj, p_jn) = (c(j), c(j_next));
                let (new_a_sq, new_b_sq) = (d2(pj, pi), d2(p_jn, p_in));
                if new_a_sq >= elsq[i] && new_b_sq >= elsq[j] {
                    continue;
                }
                let gain = el[i] + el[j] - new_a_sq.sqrt() - new_b_sq.sqrt();
                if gain > best_gain {
                    (best_i, best_j, best_gain) = (i, j, gain);
                }
            }
        }
        if best_i == pn {
            break;
        }
        improved = true;
        path[best_i + 1..=best_j].reverse();
    }
    improved
}

/// Moves runs of up to three points of the cycle next to one of the 8 points nearest an end of the run, reversed
/// or not, while that shortens it; the first point stays first (Orca's `improve_cycle_by_or_opt`).
fn cycle_or_opt(path: &mut Vec<usize>, points: &[Pt]) -> bool {
    let pn = path.len();
    if pn < 5 {
        return false;
    }
    let coords: Vec<V> = points.iter().map(|&p| v(p)).collect();
    let grid = Nearest::new(&coords);
    let mut pos = vec![0usize; points.len()];
    let refresh = |path: &[usize], pos: &mut Vec<usize>| {
        for (k, &p) in path.iter().enumerate() {
            pos[p] = k;
        }
    };
    refresh(path, &mut pos);
    let mut improved = false;
    let mut moved = true;
    while moved {
        moved = false;
        for len in 1..=3usize {
            let mut i = 1;
            while i + len <= pn {
                let dist = |path: &[usize], a: usize, b: usize| norm(coords[path[a % pn]], coords[path[b % pn]]);
                let last = i + len - 1;
                let removal = dist(path, i - 1, i) + dist(path, last, last + 1) - dist(path, i - 1, last + 1);
                let mut applied = removal <= SCALED_EPSILON;
                for end in [path[i], path[last]] {
                    let near = grid.query(coords[end], 8, &|idx| idx != end);
                    for slot in 0..8 {
                        let q = near.get(slot).copied();
                        for which in 0..2 {
                            let k = match q {
                                None => pn,
                                Some(q) => {
                                    if which == 0 {
                                        (pos[q] + pn - 1) % pn
                                    } else {
                                        pos[q]
                                    }
                                }
                            };
                            if applied || k == pn || (k + 1 >= i && k <= last) {
                                continue;
                            }
                            let base = dist(path, k, k + 1);
                            let kept = dist(path, k, i) + dist(path, last, k + 1) - base;
                            let reversed = dist(path, k, last) + dist(path, i, k + 1) - base;
                            if kept.min(reversed) > removal - SCALED_EPSILON {
                                continue;
                            }
                            let mut run: Vec<usize> = path[i..=last].to_vec();
                            if reversed < kept {
                                run.reverse();
                            }
                            path.drain(i..=last);
                            let at = if k < i { k + 1 } else { k + 1 - len };
                            path.splice(at..at, run);
                            refresh(path, &mut pos);
                            applied = true;
                            moved = true;
                            improved = true;
                        }
                    }
                }
                i += 1;
            }
        }
    }
    improved
}

/// Whether two segments cross or touch (Orca's `Geometry::segments_intersect`).
fn segments_intersect(ip1: Pt, ip2: Pt, jp1: Pt, jp2: Pt) -> bool {
    let signs = |a: Pt, b: Pt, c: Pt, d: Pt| {
        let (vx, vy) = (b.x as i64 - a.x as i64, b.y as i64 - a.y as i64);
        let t = |p: Pt| (vx * (p.y as i64 - a.y as i64) - vy * (p.x as i64 - a.x as i64)).signum();
        (t(c), t(d))
    };
    let s1 = signs(ip1, ip2, jp1, jp2);
    let s2 = signs(jp1, jp2, ip1, ip2);
    let (t1, t2) = (s1.0 * s1.1, s2.0 * s2.1);
    if t1 > 0 || t2 > 0 {
        return false;
    }
    if t1 != 0 || t2 != 0 {
        return true;
    }
    if s1.0 == 0 && s1.1 == 0 {
        let (vx, vy) = (ip2.x - ip1.x, ip2.y - ip1.y);
        let along = |p: Pt| if vx.abs() > vy.abs() { p.x } else { p.y };
        let (mut i, mut j, mut k, mut l) = (along(ip1), along(ip2), along(jp1), along(jp2));
        if i > j {
            std::mem::swap(&mut i, &mut j);
        }
        if k > l {
            std::mem::swap(&mut k, &mut l);
        }
        return (k >= i && k <= j) || (i >= k && i <= l);
    }
    false
}

/// Undoes the closed tour's crossings one at a time, the first found each time (Orca's `tsp_remove_crossings`).
fn remove_crossings(path: &mut [usize], centers: &[Pt]) -> bool {
    let pn = path.len();
    if pn <= 3 {
        return false;
    }
    let boxes_overlap = |a: Pt, b: Pt, c: Pt, d: Pt| {
        !(a.x.max(b.x) < c.x.min(d.x)
            || c.x.max(d.x) < a.x.min(b.x)
            || a.y.max(b.y) < c.y.min(d.y)
            || c.y.max(d.y) < a.y.min(b.y))
    };
    let find = |path: &[usize]| -> Option<(usize, usize)> {
        for i in 0..pn {
            let (ai, bi) = (centers[path[i]], centers[path[(i + 1) % pn]]);
            for j in i + 2..pn {
                if i == 0 && j == pn - 1 {
                    continue;
                }
                let (aj, bj) = (centers[path[j]], centers[path[(j + 1) % pn]]);
                if boxes_overlap(ai, bi, aj, bj) && segments_intersect(ai, bi, aj, bj) {
                    return Some((i, j));
                }
            }
        }
        None
    };
    let hash =
        |path: &[usize]| path.iter().fold(1469598103934665603u64, |h, &i| (h ^ i as u64).wrapping_mul(1099511628211));
    let reverse_first = |path: &mut [usize]| match find(path) {
        Some((i, j)) => {
            path[i + 1..=j].reverse();
            true
        }
        None => false,
    };
    let max_iters = (pn * pn) as i64;
    let mut improved = false;
    // The orderings reached, by hash (sorted), with the reversals done when each was.
    let mut seen: Vec<(u64, i64)> = vec![(hash(path), 0)];
    let mut iter = 1;
    while iter <= max_iters && reverse_first(path) {
        improved = true;
        let h = hash(path);
        match seen.binary_search_by_key(&h, |e| e.0) {
            Ok(at) => {
                // Repeating: take only the steps to where the capped loop would have stopped.
                for _ in 0..(max_iters - iter) % (iter - seen[at].1) {
                    reverse_first(path);
                }
                break;
            }
            Err(at) => seen.insert(at, (h, iter)),
        }
        iter += 1;
    }
    improved
}

/// Starts the closed tour where its closing link is shortest (Orca's `tsp_rotate_minimize_closing`).
fn rotate_minimize_closing(path: &mut [usize], centers: &[Pt]) {
    let pn = path.len();
    let mut best = (0, f64::MAX);
    for start in 0..pn {
        let last = (start + pn - 1) % pn;
        let d = d2(v(centers[path[start]]), v(centers[path[last]]));
        if d < best.1 {
            best = (start, d);
        }
    }
    path.rotate_left(best.0);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geom::pt;

    fn length(chain: &[(usize, bool)], ends: &[(Pt, Pt)], start: Pt) -> f64 {
        let points: Vec<V> = ends.iter().flat_map(|&(a, b)| [v(a), v(b)]).collect();
        travel(chain, &points, v(start))
    }

    #[test]
    fn parallel_lines_chain_as_a_zig_zag() {
        // Ten vertical lines 1 mm apart, all drawn upwards: the chain runs them alternately up and down.
        let ends: Vec<(Pt, Pt)> = (0..10).map(|i| (pt(i * 10_000, 0), pt(i * 10_000, 100_000))).collect();
        let order = chain(&ends, &[true; 10], Some(pt(-5_000, 0)), false);
        assert_eq!(order.iter().map(|o| o.0).collect::<Vec<_>>(), (0..10).collect::<Vec<_>>());
        for (k, &(_, flipped)) in order.iter().enumerate() {
            assert_eq!(flipped, k % 2 == 1);
        }
        assert!((length(&order, &ends, pt(-5_000, 0)) - 9.0 * 10_000.0 - 5_000.0).abs() < 1.0);
    }

    #[test]
    fn fixed_paths_are_never_reversed() {
        let ends: Vec<(Pt, Pt)> = (0..12).map(|i| (pt(i * 10_000, 0), pt(i * 10_000, 100_000))).collect();
        for improve in [false, true] {
            let order = chain(&ends, &[false; 12], Some(pt(0, 0)), improve);
            assert_eq!(order.len(), 12);
            assert!(order.iter().all(|o| !o.1));
            let mut seen: Vec<usize> = order.iter().map(|o| o.0).collect();
            seen.sort_unstable();
            assert_eq!(seen, (0..12).collect::<Vec<_>>());
        }
    }

    #[test]
    fn improving_never_lengthens_the_chain() {
        // Scattered short dashes: the improved chain travels no further than the greedy one.
        let mut ends = Vec::new();
        let mut seed = 12345u64;
        let mut next = || {
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            ((seed >> 33) % 400_000) as i32
        };
        for _ in 0..60 {
            let (x, y) = (next(), next());
            ends.push((pt(x, y), pt(x + 8_000, y + 3_000)));
        }
        let start = pt(0, 0);
        let greedy = chain(&ends, &[true; 60], Some(start), false);
        let improved = chain(&ends, &[true; 60], Some(start), true);
        assert!(length(&improved, &ends, start) <= length(&greedy, &ends, start) + 1.0);
        let mut seen: Vec<usize> = improved.iter().map(|o| o.0).collect();
        seen.sort_unstable();
        assert_eq!(seen, (0..60).collect::<Vec<_>>());
    }

    #[test]
    fn few_islands_tour_exactly_from_the_nearest() {
        // A square's corners and its middle: the tour starts at the corner nearest the origin and goes on to its
        // nearer neighbour.
        let points = [pt(100, 100), pt(100, 0), pt(0, 0), pt(0, 100), pt(50, 50)];
        let path = tour(&points, Some(pt(-10, -10)));
        assert_eq!(path[0], 2);
        assert_eq!(path.len(), 5);
        let mut seen = path.clone();
        seen.sort_unstable();
        assert_eq!(seen, vec![0, 1, 2, 3, 4]);
    }

    #[test]
    fn many_islands_tour_without_crossings() {
        let mut points = Vec::new();
        for i in 0..5 {
            for j in 0..4 {
                points.push(pt(i * 1000 + (j % 2) * 300, j * 1000));
            }
        }
        let path = tour(&points, Some(pt(0, 0)));
        assert_eq!(path.len(), 20);
        let pn = path.len();
        for i in 0..pn {
            for j in i + 2..pn {
                if i == 0 && j == pn - 1 {
                    continue;
                }
                let (a, b) = (points[path[i]], points[path[(i + 1) % pn]]);
                let (c, d) = (points[path[j]], points[path[(j + 1) % pn]]);
                assert!(!segments_intersect(a, b, c, d), "edges {i} and {j} cross");
            }
        }
    }
}
