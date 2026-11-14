//! The order Orca's `std::unordered_map<Point, …, PointHash>` keeps its points in, as libstdc++ (GCC 14, which Orca
//! 2.5 is built with) keeps them. Orca's classic trees group each layer's nodes in such maps (`nodes_per_part` in
//! `TreeSupport::drop_nodes`) and merge and move them in that order, so the trees depend on it.

use std::collections::HashMap;

/// The map's bucket counts as it grows one key at a time: 13 buckets for the first key, then, once it holds a key
/// more than it has buckets, the next prime at least twice as many (libstdc++'s `_Prime_rehash_policy`).
const BUCKETS: [usize; 19] = [
    13, 29, 59, 127, 257, 541, 1109, 2357, 5087, 10273, 20753, 42043, 85229, 172933, 351061, 712697, 1447153, 2938679,
    5967347,
];

const NONE: u32 = u32::MAX;
/// A bucket whose first node is the list's first (libstdc++ points it at `_M_before_begin`).
const BEFORE_BEGIN: u32 = u32::MAX - 1;

/// Orca's `PointHash` of a point in nanometres, as `size_t`.
fn hash(p: (i64, i64)) -> u64 {
    (89 * 31 + p.0).wrapping_mul(31).wrapping_add(p.1) as u64
}

/// An `std::unordered_map<Point, V, PointHash>` filled with `operator[]`: a key put again keeps its place and takes
/// the new value.
pub struct StdMap<V> {
    keys: Vec<(i64, i64)>,
    values: Vec<V>,
    /// Each node's successor in the one list all buckets share.
    next: Vec<u32>,
    head: u32,
    /// Each bucket's node before its first (`BEFORE_BEGIN` for the list's first), `NONE` when empty.
    buckets: Vec<u32>,
    at: HashMap<(i64, i64), u32>,
}

impl<V> Default for StdMap<V> {
    fn default() -> Self {
        StdMap {
            keys: Vec::new(),
            values: Vec::new(),
            next: Vec::new(),
            head: NONE,
            buckets: Vec::new(),
            at: HashMap::new(),
        }
    }
}

impl<V> StdMap<V> {
    pub fn len(&self) -> usize {
        self.keys.len()
    }

    pub fn is_empty(&self) -> bool {
        self.keys.is_empty()
    }

    pub fn get(&self, key: (i64, i64)) -> Option<&V> {
        self.at.get(&key).map(|&i| &self.values[i as usize])
    }

    /// `map[key] = value`.
    pub fn put(&mut self, key: (i64, i64), value: V) {
        if let Some(&i) = self.at.get(&key) {
            self.values[i as usize] = value;
            return;
        }
        let n = self.keys.len();
        if n == self.buckets.len() {
            // The first key, or one more than there are buckets.
            let grown = BUCKETS.iter().copied().find(|&b| b > n).unwrap_or(n * 2 + 1);
            self.rehash(grown);
        }
        let node = n as u32;
        self.keys.push(key);
        self.values.push(value);
        self.next.push(NONE);
        self.at.insert(key, node);
        let bkt = self.bucket(key);
        // `_M_insert_bucket_begin`: first in its bucket; into an empty bucket, first in the list.
        match self.buckets[bkt] {
            NONE => {
                self.next[node as usize] = self.head;
                self.head = node;
                let after = self.next[node as usize];
                if after != NONE {
                    let b = self.bucket(self.keys[after as usize]);
                    self.buckets[b] = node;
                }
                self.buckets[bkt] = BEFORE_BEGIN;
            }
            before => self.link_after(before, node),
        }
    }

    fn bucket(&self, key: (i64, i64)) -> usize {
        (hash(key) % self.buckets.len() as u64) as usize
    }

    /// Puts `node` right after `before` (`BEFORE_BEGIN`: at the list's start).
    fn link_after(&mut self, before: u32, node: u32) {
        if before == BEFORE_BEGIN {
            self.next[node as usize] = self.head;
            self.head = node;
        } else {
            self.next[node as usize] = self.next[before as usize];
            self.next[before as usize] = node;
        }
    }

    /// `_M_rehash_aux` for unique keys: the nodes taken in list order into the new buckets.
    fn rehash(&mut self, count: usize) {
        self.buckets = vec![NONE; count];
        let mut p = self.head;
        self.head = NONE;
        let mut begin_bucket = 0;
        while p != NONE {
            let after = self.next[p as usize];
            let bkt = self.bucket(self.keys[p as usize]);
            if self.buckets[bkt] == NONE {
                self.next[p as usize] = self.head;
                self.head = p;
                self.buckets[bkt] = BEFORE_BEGIN;
                if self.next[p as usize] != NONE {
                    self.buckets[begin_bucket] = p;
                }
                begin_bucket = bkt;
            } else {
                let before = self.buckets[bkt];
                self.link_after(before, p);
            }
            p = after;
        }
    }

    /// The keys and values in the map's order.
    pub fn iter(&self) -> impl Iterator<Item = ((i64, i64), &V)> {
        let mut p = self.head;
        std::iter::from_fn(move || {
            (p != NONE).then(|| {
                let i = p as usize;
                p = self.next[i];
                (self.keys[i], &self.values[i])
            })
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn points_come_out_in_libstdcpps_order() {
        // From libstdc++ 14.2 (an `std::unordered_map<Point, int, PointHash>` filled in this order and iterated),
        // across its first two rehashes, with a key put twice and negative coordinates.
        let mut m = StdMap::default();
        let pts: Vec<(i64, i64)> =
            (0..40).map(|i| ((i * 7_919_333) % 1_000_003 - 500_000, (i * i * 104_729) % 999_983)).collect();
        for (i, &p) in pts.iter().enumerate() {
            m.put(p, i);
        }
        m.put(pts[3], 99);
        let order: Vec<usize> = m.iter().map(|(_, &v)| v).collect();
        assert_eq!(order.len(), 40);
        assert_eq!(order, EXPECTED);
    }

    const EXPECTED: [usize; 40] = [
        39, 38, 37, 36, 34, 31, 10, 35, 12, 11, 19, 7, 2, 5, 6, 27, 18, 4, 9, 30, 24, 33, 1, 32, 99, 8, 13, 14, 0, 15,
        22, 16, 26, 29, 17, 20, 21, 23, 25, 28,
    ];
}
