//! Painted colours of a Bambu Studio or OrcaSlicer project. Each painted triangle of a mesh carries a code
//! (`paint_color` in its 3MF) that Orca's TriangleSelector writes and reads (TriangleSelector.cpp `deserialize`,
//! `perform_split`; Model.cpp `set_triangle_from_string`): the triangle split into smaller ones, each in a state, the
//! filament it prints in (1 the first; 0 unpainted, the mesh's own). A code is hex digits read from the last one:
//! each node of a triangle's split tree is a digit, its two low bits how many sides it splits (0: a leaf) and its two
//! high bits the leaf's state, or the corner the split starts from. A leaf's state of 3 and up takes one more digit
//! (state − 3), or F and one more (state − 18). A split node's children follow, depth first, the last one first.
//!
//! The app hands a mesh's paint in the same form as OrcaSlicer's engine takes it (`paint.filaments`): the painted
//! triangles' indices, ascending, their codes one after another, and where each code ends.

/// The highest state OrcaSlicer's engine takes: Orca's 32 filaments.
pub const MAX_STATE: u32 = 32;

/// A mesh's painted triangles: each one's index in the mesh, ascending, and its code.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Paint {
    pub triangles: Vec<u32>,
    /// The codes, one after another (hex digits, upper case).
    pub codes: Vec<u8>,
    /// Where each triangle's code ends in `codes`.
    pub ends: Vec<u32>,
    /// The painted triangles whose corners the mesh holds in the other order (a mirrored part's, turned back
    /// outward): their codes go by the corners as the file has them.
    pub turned: Vec<bool>,
}

impl Paint {
    /// Reads paint as the app hands it: a little-endian u32 count n, n triangle indices (u32, ascending), n code
    /// ends (u32), then the codes (ASCII). Codes that aren't ones, or paint nothing, are left out, as Orca leaves
    /// them; None when the bytes aren't paint.
    pub fn from_bytes(bytes: &[u8]) -> Option<Paint> {
        let word = |at: usize| bytes.get(at..at + 4).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]));
        let n = word(0)? as usize;
        let codes_at = n.checked_mul(8)?.checked_add(4)?;
        let codes = bytes.get(codes_at..)?;
        let mut paint = Paint::default();
        let (mut from, mut previous) = (0usize, None);
        for k in 0..n {
            let triangle = word(4 + k * 4)?;
            let end = word(4 + n * 4 + k * 4)? as usize;
            if end < from || end > codes.len() || previous.is_some_and(|p| triangle <= p) {
                return None;
            }
            paint.push(triangle, &codes[from..end], false);
            (from, previous) = (end, Some(triangle));
        }
        (from == codes.len()).then_some(paint)
    }

    /// Adds a painted triangle (after those already in), unless its code isn't one or paints nothing.
    pub fn push(&mut self, triangle: u32, code: &[u8], turned: bool) {
        if states(code).is_some_and(|s| s > 1) {
            self.triangles.push(triangle);
            self.codes.extend_from_slice(code);
            self.ends.push(self.codes.len() as u32);
            self.turned.push(turned);
        }
    }

    pub fn is_empty(&self) -> bool {
        self.triangles.is_empty()
    }

    /// Each painted triangle: its index, its code and whether its corners are turned.
    pub fn iter(&self) -> impl Iterator<Item = (u32, &[u8], bool)> {
        let starts = std::iter::once(0).chain(self.ends.iter().map(|&e| e as usize));
        self.triangles
            .iter()
            .zip(starts.zip(&self.ends))
            .zip(&self.turned)
            .map(|((&t, (from, &to)), &turned)| (t, &self.codes[from..to as usize], turned))
    }

    /// The states painted with (bit n for state n), 0 for none.
    pub fn states(&self) -> u64 {
        self.iter().filter_map(|(_, code, _)| states(code)).fold(0, |all, s| all | s)
    }

    /// The same paint for the mesh's triangles after some were dropped (`moved`: each original triangle's new index,
    /// None where it was dropped), in the new order.
    pub fn moved(&self, moved: impl Fn(u32) -> Option<u32>) -> Paint {
        let mut kept: Vec<(u32, &[u8], bool)> =
            self.iter().filter_map(|(t, code, turned)| moved(t).map(|n| (n, code, turned))).collect();
        kept.sort_by_key(|k| k.0);
        let mut out = Paint::default();
        for (t, code, turned) in kept {
            out.push(t, code, turned);
        }
        out
    }
}

fn digit(c: u8) -> Option<u32> {
    match c {
        b'0'..=b'9' => Some(u32::from(c - b'0')),
        b'A'..=b'F' => Some(u32::from(c - b'A') + 10),
        _ => None,
    }
}

/// Reads a code's digits from its last one.
struct Digits<'a> {
    code: &'a [u8],
    at: usize,
}

impl Digits<'_> {
    fn next(&mut self) -> Option<u32> {
        self.at = self.at.checked_sub(1)?;
        digit(self.code[self.at])
    }

    /// A leaf's state, after its first digit's two high bits `x`.
    fn state(&mut self, x: u32) -> Option<u32> {
        if x < 3 {
            return Some(x);
        }
        let e = self.next()?;
        if e < 15 { Some(e + 3) } else { Some(self.next()? + 18) }
    }
}

/// The states a code paints with (bit n for state n), or None where it isn't a code OrcaSlicer's engine takes:
/// digits other than 0-9 and A-F, a split from a corner past the third, a tree that ends early or text after it, a
/// state past 32 (Orca drops such a triangle's paint).
pub fn states(code: &[u8]) -> Option<u64> {
    let mut digits = Digits { code, at: code.len() };
    let (mut open, mut states) = (1u32, 0u64);
    while open > 0 {
        let head = digits.next()?;
        open -= 1;
        let (split, x) = (head & 3, head >> 2);
        if split != 0 {
            if x > 2 {
                return None;
            }
            open += split + 1;
            continue;
        }
        let state = digits.state(x)?;
        if state > MAX_STATE {
            return None;
        }
        states |= 1 << state;
    }
    (digits.at == 0).then_some(states)
}

type Corners = [[f32; 3]; 3];

/// Orca's midpoint of a split side: `0.5f * (a + b)`, in floats.
fn mid(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [0.5 * (a[0] + b[0]), 0.5 * (a[1] + b[1]), 0.5 * (a[2] + b[2])]
}

/// A split triangle's children, as `perform_split` makes them: a split of one side halves the side opposite the
/// corner it starts from (`start`), of two sides the two sides at that corner, of three every side.
fn children(split: u32, start: usize, [a, b, c]: Corners) -> ([Corners; 4], usize) {
    let turned = [a, b, c];
    let v0 = turned[start];
    let v1 = turned[(start + 1) % 3];
    let v2 = turned[(start + 2) % 3];
    match split {
        1 => {
            let m12 = mid(v2, v1);
            ([[v0, v1, m12], [m12, v2, v0], [v0; 3], [v0; 3]], 2)
        }
        2 => {
            let m01 = mid(v1, v0);
            let m02 = mid(v0, v2);
            ([[v0, m01, m02], [m01, v1, m02], [v1, v2, m02], [v0; 3]], 3)
        }
        _ => {
            let m01 = mid(v1, v0);
            let m12 = mid(v2, v1);
            let m02 = mid(v0, v2);
            ([[v0, m01, m02], [m01, v1, m12], [m12, v2, m02], [m01, m12, m02]], 4)
        }
    }
}

/// A painted triangle's leaves, each with its corners and state, in the order Orca's TriangleSelector lists them
/// (`get_facets`): a split's children in the order it makes them, each one's own after it. None where the code
/// isn't one.
pub fn leaves(code: &[u8], corners: Corners) -> Option<Vec<(Corners, u32)>> {
    // Orca reads a split's children the last one first, depth first; the leaves it lists go by when each triangle was
    // made. Each node read: its corners, and where its children (if a split) begin in `made`.
    let mut digits = Digits { code, at: code.len() };
    // Every triangle made, in order: its corners, and its state (None while split).
    let mut made: Vec<(Corners, Option<u32>)> = vec![(corners, None)];
    // Triangles still to read, the next one last: their index in `made`.
    let mut pending = vec![0usize];
    while let Some(node) = pending.pop() {
        let head = digits.next()?;
        let (split, x) = (head & 3, head >> 2);
        if split == 0 {
            made[node].1 = Some(digits.state(x)?);
            continue;
        }
        if split != 3 && x > 2 {
            return None;
        }
        let (kids, count) = children(split, if split == 3 { 0 } else { x as usize }, made[node].0);
        let first = made.len();
        made.extend(kids[..count].iter().map(|&k| (k, None)));
        // Pushed in order, so the last child is read first, as Orca reads them.
        pending.extend(first..first + count);
    }
    if digits.at != 0 {
        return None;
    }
    Some(made.into_iter().filter_map(|(corners, state)| state.map(|s| (corners, s))).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    const A: [f32; 3] = [0.0, 0.0, 0.0];
    const B: [f32; 3] = [8.0, 0.0, 0.0];
    const C: [f32; 3] = [0.0, 8.0, 0.0];

    fn states_of(code: &str) -> Option<Vec<u32>> {
        states(code.as_bytes()).map(|s| (0..=33).filter(|n| s & (1 << n) != 0).collect())
    }

    #[test]
    fn reads_a_leafs_state_in_one_two_or_three_digits() {
        assert_eq!(states_of("0"), Some(vec![0]));
        assert_eq!(states_of("4"), Some(vec![1]));
        assert_eq!(states_of("8"), Some(vec![2]));
        assert_eq!(states_of("0C"), Some(vec![3]));
        assert_eq!(states_of("EC"), Some(vec![17]));
        assert_eq!(states_of("0FC"), Some(vec![18]));
        assert_eq!(states_of("EFC"), Some(vec![32]));
    }

    #[test]
    fn refuses_what_orcaslicers_engine_refuses() {
        // Past 32 filaments, a digit that isn't one, a tree that ends early, text after it, a split from a 4th corner.
        for code in ["FFC", "8g", "81", "48", "08D", ""] {
            assert_eq!(states(code.as_bytes()), None, "{code}");
        }
    }

    #[test]
    fn splits_as_orca_splits() {
        // One side, from corner 0: the side opposite it halved; the children listed as made, read the last first.
        let m = |p: [f32; 3], q: [f32; 3]| mid(p, q);
        assert_eq!(leaves(b"081", [A, B, C]), Some(vec![([A, B, m(C, B)], 0), ([m(C, B), C, A], 2)]));
        // From corner 1: B, C, A.
        assert_eq!(leaves(b"485", [A, B, C]), Some(vec![([B, C, m(A, C)], 1), ([m(A, C), A, B], 2)]));
        // Two sides at corner 0.
        assert_eq!(
            leaves(b"4082", [A, B, C]),
            Some(vec![([A, m(B, A), m(A, C)], 1), ([m(B, A), B, m(A, C)], 0), ([B, C, m(A, C)], 2)])
        );
        // Three sides: four children, the middle one last.
        let four = leaves(b"40883", [A, B, C]).unwrap();
        assert_eq!(four.iter().map(|l| l.1).collect::<Vec<_>>(), vec![1, 0, 2, 2]);
        assert_eq!(four[3].0, [m(B, A), m(C, B), m(A, C)]);
    }

    #[test]
    fn lists_a_split_inside_a_split_after_its_parent_s_children() {
        // Three sides (3); the last child split in two (1), its children's states 2 and 1; then the others', last first.
        let read = leaves(b"4804813", [A, B, C]).unwrap();
        // Orca lists the four children (three of them leaves) first, then the middle one's two.
        assert_eq!(read.iter().map(|l| l.1).collect::<Vec<_>>(), vec![1, 2, 0, 1, 2]);
        let area =
            |[p, q, r]: [[f32; 3]; 3]| ((q[0] - p[0]) * (r[1] - p[1]) - (r[0] - p[0]) * (q[1] - p[1])).abs() / 2.0;
        assert_eq!(read.iter().map(|l| area(l.0)).sum::<f32>(), area([A, B, C]));
    }

    #[test]
    fn reads_paint_as_the_app_hands_it_and_follows_moved_triangles() {
        let mut bytes = Vec::new();
        for word in [3u32, 2, 5, 9, 1, 3, 4] {
            bytes.extend_from_slice(&word.to_le_bytes());
        }
        bytes.extend_from_slice(b"8" as &[u8]);
        bytes.extend_from_slice(b"0C4");
        let paint = Paint::from_bytes(&bytes).unwrap();
        assert_eq!(paint.triangles, vec![2, 5, 9]);
        assert_eq!(
            paint.iter().map(|(_, c, _)| c.to_vec()).collect::<Vec<_>>(),
            vec![b"8".to_vec(), b"0C".to_vec(), b"4".to_vec()]
        );
        assert_eq!(paint.states(), 0b1110);
        // Triangle 5 dropped, 9 moved into 2's place and 2 to 7.
        let moved = paint.moved(|t| match t {
            2 => Some(7),
            9 => Some(2),
            _ => None,
        });
        assert_eq!(moved.triangles, vec![2, 7]);
        assert_eq!(moved.codes, b"48".to_vec());
        // Indices that don't ascend, or codes that run past the end, aren't paint.
        let mut bad = bytes.clone();
        bad[8..12].copy_from_slice(&1u32.to_le_bytes());
        assert_eq!(Paint::from_bytes(&bad), None);
        assert_eq!(Paint::from_bytes(&bytes[..bytes.len() - 1]), None);
    }
}
