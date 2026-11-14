use crate::core::edge_data::{EdgeDataSplit, OverlayEdgeData};
use crate::core::integer::OverlayInt;
use crate::core::solver::Solver;
use crate::geom::x_segment::XSegment;
use crate::segm::merge::ShapeSegmentsMerge;
use crate::segm::segment::Segment;
use crate::segm::sort::ShapeSegmentsSort;
use crate::segm::winding::WindingCount;
use crate::split::cross_solver::{CrossSolver, CrossType, EndMask};
use crate::split::line_mark::{LineMark, SortMarkByIndexAndPoint};
use alloc::vec::Vec;
use i_float::int::number::int::IntNumber;

pub(crate) struct SplitSolver<I: IntNumber> {
    pub(super) marks: Vec<LineMark<I>>,
    /// The segments the last `apply` made: the pieces of the segments it split.
    pub(super) pieces: Vec<XSegment<I>>,
}

impl<I: IntNumber> SplitSolver<I> {
    #[inline(always)]
    pub(crate) fn new() -> Self {
        Self {
            marks: Vec::new(),
            pieces: Vec::new(),
        }
    }
}

impl<I> SplitSolver<I>
where
    I: OverlayInt,
{
    #[inline]
    pub(crate) fn split_segments<C: WindingCount, D: OverlayEdgeData<C>>(
        &mut self,
        segments: &mut Vec<Segment<C, I, D>>,
        solver: &Solver,
    ) -> bool {
        let mut store = D::Store::default();
        self.split_segments_with_store(segments, solver, &mut store)
    }

    #[inline]
    pub(crate) fn split_segments_with_store<C: WindingCount, D: OverlayEdgeData<C>>(
        &mut self,
        segments: &mut Vec<Segment<C, I, D>>,
        solver: &Solver,
        store: &mut D::Store,
    ) -> bool {
        if segments.is_empty() {
            return false;
        }

        segments.sort_by_ab(solver.is_parallel_sort_allowed());
        let any_merged = segments.merge_if_needed_with_store(store);
        if segments.is_empty() {
            return true;
        }

        let any_intersection = self.split(segments, solver, store);
        any_merged | any_intersection
    }

    #[inline]
    fn split<C: WindingCount, D: OverlayEdgeData<C>>(
        &mut self,
        segments: &mut Vec<Segment<C, I, D>>,
        solver: &Solver,
        store: &mut D::Store,
    ) -> bool {
        let is_list = solver.is_list_split(segments);
        let snap_radius = solver.snap_radius();
        if is_list {
            return self.list_split(snap_radius, segments, solver, store);
        }

        let is_fragmentation = solver.is_fragmentation_required(segments);

        if is_fragmentation {
            self.fragment_split(snap_radius, segments, solver, store)
        } else {
            self.tree_split(snap_radius, segments, solver, store)
        }
    }

    /// The indices of the segments the last `apply` made, in order, when they are few enough for `fresh_pass` to
    /// pay: false when they are not (or no `apply` came first, `fresh_pass` then can't stand in for a full pass).
    pub(super) fn fresh<C, D>(&self, segments: &[Segment<C, I, D>], fresh: &mut Vec<usize>) -> bool {
        fresh.clear();
        if self.pieces.is_empty() || self.pieces.len() * 4 > segments.len() {
            return false;
        }
        for piece in &self.pieces {
            if let Ok(k) = segments.binary_search_by(|s| s.x_segment.cmp(piece)) {
                fresh.push(k);
            }
        }
        fresh.sort_unstable();
        fresh.dedup();
        true
    }

    /// A pass over the pairs with a segment the last `apply` made (`fresh`, their indices in order) after a full pass:
    /// every other pair was tested in an earlier pass and found apart, and is unchanged since, so this pushes the
    /// marks a pass over all pairs would (in another order, which `apply` sorts away). It tests a pair when the lists
    /// and the tree do: the later segment starts at or before the earlier one's end, and their y ranges meet.
    pub(super) fn fresh_pass<C, D>(
        &mut self,
        segments: &[Segment<C, I, D>],
        fresh: &[usize],
        radius_squared: I::WideUInt,
    ) -> bool {
        let mut need_to_fix = false;
        let mut next = 0;
        for (i, si) in segments.iter().enumerate() {
            let xsi = &si.x_segment;
            if next < fresh.len() && fresh[next] == i {
                next += 1;
                let ri = xsi.y_range();
                for (j, sj) in segments.iter().enumerate().skip(i + 1) {
                    let xsj = &sj.x_segment;
                    if xsi.b.x < xsj.a.x {
                        break;
                    }
                    if xsj.is_not_intersect_y_range(&ri) {
                        continue;
                    }
                    need_to_fix |= Self::cross(i, j, xsi, xsj, &mut self.marks, radius_squared);
                }
            } else {
                for &j in &fresh[next..] {
                    let xsj = &segments[j].x_segment;
                    if xsi.b.x < xsj.a.x {
                        break;
                    }
                    if xsj.is_not_intersect_y_range(&xsi.y_range()) {
                        continue;
                    }
                    need_to_fix |= Self::cross(i, j, xsi, xsj, &mut self.marks, radius_squared);
                }
            }
        }
        need_to_fix
    }

    pub(super) fn cross(
        i: usize,
        j: usize,
        ei: &XSegment<I>,
        ej: &XSegment<I>,
        marks: &mut Vec<LineMark<I>>,
        radius_squared: I::WideUInt,
    ) -> bool {
        let cross = if let Some(cross) = CrossSolver::<I>::cross(ei, ej, radius_squared) {
            cross
        } else {
            return false;
        };

        match cross.cross_type {
            CrossType::Pure => {
                marks.push(LineMark {
                    index: i,
                    point: cross.point,
                });
                marks.push(LineMark {
                    index: j,
                    point: cross.point,
                });
            }
            CrossType::TargetEnd => {
                marks.push(LineMark {
                    index: j,
                    point: cross.point,
                });
            }
            CrossType::OtherEnd => {
                marks.push(LineMark {
                    index: i,
                    point: cross.point,
                });
            }
            CrossType::Overlay => {
                let mask = CrossSolver::<I>::collinear(ei, ej);
                if mask == 0 {
                    return false;
                }

                if mask.is_target_a() {
                    marks.push(LineMark {
                        index: j,
                        point: ei.a,
                    });
                }

                if mask.is_target_b() {
                    marks.push(LineMark {
                        index: j,
                        point: ei.b,
                    });
                }

                if mask.is_other_a() {
                    marks.push(LineMark {
                        index: i,
                        point: ej.a,
                    });
                }

                if mask.is_other_b() {
                    marks.push(LineMark {
                        index: i,
                        point: ej.b,
                    });
                }
            }
        }

        cross.is_round
    }

    pub(super) fn apply<C: WindingCount, D: OverlayEdgeData<C>>(
        &mut self,
        segments: &mut Vec<Segment<C, I, D>>,
        reusable_buffer: &mut Vec<LineMark<I>>,
        solver: &Solver,
        store: &mut D::Store,
    ) {
        self.marks
            .sort_by_index_and_point(solver.is_parallel_sort_allowed(), reusable_buffer);
        self.marks.dedup();
        self.pieces.clear();

        segments.reserve(self.marks.len());
        let n0 = segments.len();
        // The segments split, in order: each is replaced in place by its first piece.
        let mut split = Vec::new();

        // split segments

        let mut i = 0;
        while i < self.marks.len() {
            let start = i;
            let m0 = self.marks[i];
            split.push(m0.index);

            i += 1;
            while i < self.marks.len() && self.marks[i].index == m0.index {
                i += 1;
            }

            let s0 = unsafe {
                // SAFETY: m0.index < segments.len() (marks are built from valid segment indices).
                // We take at most one &mut to that element per group. We drop the &mut before any push,
                // so no aliasing or reallocation invalidation can occur.
                segments.get_unchecked_mut(m0.index)
            };

            let count = s0.count;
            let data = s0.data;
            let x_seg = s0.x_segment;

            if start + 1 == i {
                // single split
                let (d0, d1) = data.split(
                    EdgeDataSplit {
                        a: x_seg.a,
                        p: m0.point,
                        b: x_seg.b,
                    },
                    store,
                );
                *s0 = Segment::create_and_validate_with_data(x_seg.a, m0.point, count, d0, store);
                self.pieces.push(s0.x_segment);
                let s1 = Segment::create_and_validate_with_data(m0.point, x_seg.b, count, d1, store);
                self.pieces.push(s1.x_segment);
                segments.push(s1);

                continue;
            }

            // we have several points
            let sub_marks = &mut self.marks[start..i];
            Self::sort_sub_marks(sub_marks, x_seg);

            let m0 = sub_marks[0];
            let (d0, mut rest_data) = data.split(
                EdgeDataSplit {
                    a: x_seg.a,
                    p: m0.point,
                    b: x_seg.b,
                },
                store,
            );
            *s0 = Segment::create_and_validate_with_data(x_seg.a, m0.point, count, d0, store);
            self.pieces.push(s0.x_segment);

            let mut p0 = m0.point;

            for mi in sub_marks.iter().skip(1) {
                let (di, next_data) = rest_data.split(
                    EdgeDataSplit {
                        a: p0,
                        p: mi.point,
                        b: x_seg.b,
                    },
                    store,
                );
                let si = Segment::create_and_validate_with_data(p0, mi.point, count, di, store);
                self.pieces.push(si.x_segment);
                segments.push(si);
                rest_data = next_data;
                p0 = mi.point;
            }

            let last = Segment::create_and_validate_with_data(p0, x_seg.b, count, rest_data, store);
            self.pieces.push(last.x_segment);
            segments.push(last);
        }

        // The segments not split are still in order: rather than sort them all again, take the pieces out, sort
        // them, and merge the two. Only equal segments can come out in another order than a sort would leave them
        // in, and those are merged next, their counts added.
        let mut pieces = segments.split_off(n0);
        let mut kept = 0;
        let mut next = 0;
        for k in 0..n0 {
            if next < split.len() && split[next] == k {
                pieces.push(segments[k]);
                next += 1;
            } else {
                segments[kept] = segments[k];
                kept += 1;
            }
        }
        segments.truncate(kept);
        pieces.sort_unstable_by(|a, b| a.x_segment.cmp(&b.x_segment));
        let old = core::mem::replace(segments, Vec::with_capacity(kept + pieces.len()));
        let (mut a, mut b) = (0, 0);
        while a < old.len() && b < pieces.len() {
            if pieces[b].x_segment < old[a].x_segment {
                segments.push(pieces[b]);
                b += 1;
            } else {
                segments.push(old[a]);
                a += 1;
            }
        }
        segments.extend_from_slice(&old[a..]);
        segments.extend_from_slice(&pieces[b..]);
        segments.merge_if_needed_with_store(store);
    }

    #[inline]
    fn sort_sub_marks(marks: &mut [LineMark<I>], x_seg: XSegment<I>) {
        let mut j0 = 0;
        let mut j = 1;

        let m0 = marks[0];
        let mut x0 = m0.point.x;
        while j < marks.len() {
            let xi = marks[j].point.x;
            if x0 == xi {
                j += 1;
                continue;
            }

            if j0 + 1 < j {
                let (y0, y1) = Self::y_range(j0, j, x_seg, marks);
                Self::sort_sub_marks_by_y(y0, y1, &mut marks[j0..j]);
            }

            x0 = xi;
            j0 = j;
            j += 1;
        }

        if j0 + 1 < j {
            let (y0, y1) = Self::y_range(j0, j, x_seg, marks);
            Self::sort_sub_marks_by_y(y0, y1, &mut marks[j0..j]);
        }
    }

    #[inline]
    fn y_range(j0: usize, j1: usize, s: XSegment<I>, marks: &[LineMark<I>]) -> (I, I) {
        let y0 = if j0 == 0 { s.a.y } else { marks[j0 - 1].point.y };
        let y1 = if j1 == marks.len() {
            s.b.y
        } else {
            marks[j1].point.y
        };
        (y0, y1)
    }

    #[inline]
    fn sort_sub_marks_by_y(y0: I, y1: I, marks: &mut [LineMark<I>]) {
        // The x-coordinate is the same for every point
        // By default, the range should be sorted in ascending order by the y-coordinate.
        if y0 > y1 {
            // reverse the order to sort the range in descending order by the y-coordinate.
            marks.reverse();
        }
    }
}

#[cfg(test)]
mod non_degenerate_tests {
    use super::*;
    use crate::segm::boolean::ShapeCountBoolean;
    use i_float::int::point::IntPoint;

    #[test]
    fn grid_intersections_do_not_create_zero_length_segments() {
        let points: Vec<_> = (-2..=2)
            .flat_map(|x| (-2..=2).map(move |y| IntPoint::new(x, y)))
            .collect();
        let mut edges = Vec::new();
        for (i, &a) in points.iter().enumerate() {
            for &b in &points[i + 1..] {
                edges.push(Segment::<ShapeCountBoolean, i32>::subject(a, b));
            }
        }
        let mut splitter = SplitSolver::new();
        let mut buffer = Vec::new();
        for (i, &a) in edges.iter().enumerate() {
            for &b in &edges[i + 1..] {
                for radius_squared in [1, 2, 4, 16] {
                    splitter.marks.clear();
                    SplitSolver::cross(
                        0,
                        1,
                        &a.x_segment,
                        &b.x_segment,
                        &mut splitter.marks,
                        radius_squared,
                    );
                    let mut segments = alloc::vec![a, b];
                    for mark in &splitter.marks {
                        let edge = segments[mark.index].x_segment;
                        assert!(
                            mark.point != edge.a && mark.point != edge.b,
                            "endpoint split: {edge:?}, {:?}",
                            mark.point
                        );
                    }
                    // Multiple intersections can produce the same mark.
                    splitter.marks.extend_from_within(..);
                    splitter.apply(&mut segments, &mut buffer, &Solver::LIST, &mut ());
                    assert!(segments.iter().all(|s| s.x_segment.a < s.x_segment.b));
                }
            }
        }
    }
}
