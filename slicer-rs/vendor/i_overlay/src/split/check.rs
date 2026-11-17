//! Spaghetti's checks of its patches (see `Cargo.toml`), for its own tests to call: built only with the
//! `spaghetti_checks` feature, which they turn on. Here, how segments are split where they cross; and the outline's
//! contours (`outline_contours`).

pub use crate::mesh::int::outline::build::outline_contours;

use crate::core::solver::Solver;
use crate::segm::boolean::ShapeCountBoolean;
use crate::segm::merge::ShapeSegmentsMerge;
use crate::segm::segment::Segment;
use crate::segm::sort::ShapeSegmentsSort;
use crate::split::line_mark::LineMark;
use crate::split::solver::SplitSolver;
use alloc::vec::Vec;
use i_float::int::point::IntPoint;

/// What [`passes`] compared.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct Passes {
    /// The passes the splitting took.
    pub passes: usize,
    /// The passes after the first that tested only the pairs with a fresh piece, as the patched solvers do.
    pub fresh: usize,
    /// The marks those found.
    pub fresh_marks: usize,
}

/// Splits the segments from each `a` to its `b` where they cross, as the list solver does, pass by pass, and panics
/// where the patch would change what it finds. Wherever `SplitSolver::fresh` lets a pass test only the pairs with a
/// piece the last pass split (`SplitSolver::fresh_pass`), that pass must mark the points a pass over every pair marks,
/// and ask for another pass where that one does. After each pass, `SplitSolver::apply` must leave the segments as
/// sorting them all again and merging the equal ones would.
pub fn passes(segments: &[([i32; 2], [i32; 2])]) -> Passes {
    let solver = Solver::LIST;
    let mut segments: Vec<Segment<ShapeCountBoolean, i32>> = segments
        .iter()
        .filter(|(a, b)| a != b)
        .map(|&(a, b)| Segment::subject(IntPoint::new(a[0], a[1]), IntPoint::new(b[0], b[1])))
        .collect();
    segments.sort_by_ab(false);
    segments.merge_if_needed_with_store(&mut ());
    let mut splitter = SplitSolver::new();
    let (mut buffer, mut fresh) = (Vec::new(), Vec::new());
    let mut radius = solver.snap_radius();
    let mut out = Passes::default();
    loop {
        let radius_squared = radius.radius_squared::<i32>();
        splitter.marks.clear();
        let need_to_fix = splitter.list_pass(&segments, radius_squared);
        let all = core::mem::take(&mut splitter.marks);
        if out.passes > 0 && splitter.fresh(&segments, &mut fresh) {
            let fresh_fix = splitter.fresh_pass(&segments, &fresh, radius_squared);
            assert!(
                same(&splitter.marks, &all),
                "pass {}: the fresh pairs' marks differ from all pairs'",
                out.passes
            );
            assert_eq!(
                fresh_fix, need_to_fix,
                "pass {}: the fresh pairs ask otherwise for another pass",
                out.passes
            );
            out.fresh += 1;
            out.fresh_marks += all.len();
        }
        out.passes += 1;
        if all.is_empty() {
            return out;
        }
        splitter.marks = all;
        splitter.apply(&mut segments, &mut buffer, &solver, &mut ());
        let mut sorted = segments.clone();
        sorted.sort_by_ab(false);
        sorted.merge_if_needed_with_store(&mut ());
        let key = |s: &Segment<ShapeCountBoolean, i32>| (s.x_segment, s.count);
        assert!(
            segments.iter().map(key).eq(sorted.iter().map(key)),
            "pass {}: the segments aren't left as a sort would leave them",
            out.passes
        );
        if !need_to_fix {
            return out;
        }
        radius.increment();
    }
}

/// Whether two passes marked the same points on the same segments, in whatever order.
fn same(a: &[LineMark<i32>], b: &[LineMark<i32>]) -> bool {
    let key = |m: &LineMark<i32>| (m.index, m.point.x, m.point.y);
    let (mut a, mut b): (Vec<_>, Vec<_>) = (a.iter().map(key).collect(), b.iter().map(key).collect());
    a.sort_unstable();
    a.dedup();
    b.sort_unstable();
    b.dedup();
    a == b
}
