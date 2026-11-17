use super::builder::OutlineBuilder;
use crate::core::fill_rule::FillRule;
use crate::core::integer::OverlayInt;
use crate::core::overlay::{ContourDirection, IntOverlayOptions, Overlay, ShapeType};
use crate::core::overlay_rule::OverlayRule;
use crate::mesh::int::join::Join;
use crate::mesh::int::math::{backend::MeshMath, float::FloatMath, integer::IntegerMath};
use crate::mesh::int::style::IntOutlineStyle;
use crate::mesh::math::MathMode;
use alloc::vec::Vec;
use i_float::int::number::uint::UIntNumber;
use i_float::int::number::wide_int::WideIntNumber;
use i_float::int::point::IntPoint;
use i_shape::flat::buffer::FlatContoursBuffer;
use i_shape::int::area::IteratorArea;

pub(crate) trait BuildOutlineOverlay<I: OverlayInt>: Sized {
    fn build_overlay(self, style: &IntOutlineStyle<I>, options: IntOverlayOptions<I::WideUInt>)
    -> Overlay<I>;
}

impl<I: OverlayInt, Paths, Path> BuildOutlineOverlay<I> for Paths
where
    Paths: IntoIterator<Item = Path>,
    Path: ExactSizeIterator<Item = IntPoint<I>> + Clone,
{
    fn build_overlay(
        self,
        style: &IntOutlineStyle<I>,
        options: IntOverlayOptions<I::WideUInt>,
    ) -> Overlay<I> {
        match style.math {
            MathMode::Integer => {
                build_outline_overlay_with_math::<I, IntegerMath, _, _>(self, style, options)
            }
            MathMode::Float => build_outline_overlay_with_math::<I, FloatMath, _, _>(self, style, options),
        }
    }
}

fn build_outline_overlay_with_math<I, M, Paths, Path>(
    paths: Paths,
    style: &IntOutlineStyle<I>,
    options: IntOverlayOptions<I::WideUInt>,
) -> Overlay<I>
where
    I: OverlayInt,
    M: MeshMath<I>,
    Paths: IntoIterator<Item = Path>,
    Path: ExactSizeIterator<Item = IntPoint<I>> + Clone,
{
    let mut outer_builder = OutlineBuilder::new(
        style.outer_offset,
        Join::<I, M>::new(style.join, style.miter_min_turn),
    );
    let mut inner_builder = OutlineBuilder::new(
        style.inner_offset,
        Join::<I, M>::new(style.join, style.miter_min_turn),
    );

    let mut overlay = Overlay::new_custom(0, options, Default::default());
    let mut contour_options = options;

    // Contours below the threshold can join into a larger surviving result.
    contour_options.min_output_area = I::WideUInt::ZERO;

    let mut contour_overlay = Overlay::new_custom(0, contour_options, Default::default());
    let mut segments = Vec::new();
    let mut contours = FlatContoursBuffer::default();

    for path in paths {
        if path.len() < 3 {
            continue;
        }
        let area = path.clone().area_two();
        if area == I::Wide::ZERO {
            continue;
        }
        let (builder, direction, fill) = if area > I::Wide::ZERO {
            (
                &mut outer_builder,
                ContourDirection::CounterClockwise,
                FillRule::Positive,
            )
        } else {
            (
                &mut inner_builder,
                ContourDirection::Clockwise,
                FillRule::Negative,
            )
        };
        segments.clear();
        builder.build(path, &mut segments);

        contour_overlay.options.output_direction = direction;
        contour_overlay.clear();
        contour_overlay.add_segments(&segments);
        contour_overlay.overlay_into(OverlayRule::Subject, fill, &mut contours);
        overlay.add_source(&contours, ShapeType::Subject);
    }
    overlay
}

/// Spaghetti's check of its patch here (see `Cargo.toml`), for its own tests to call through `spaghetti_checks`:
/// offsets each closed path by `offset` with mitred corners down to `min_angle` radians, resolves the offset path as
/// the outline now does (building only the subject's links) and as it did before (every link, the subject's kept), and
/// panics where the contours differ. Returns how many contours came out.
#[cfg(feature = "spaghetti_checks")]
pub fn outline_contours(paths: &[Vec<[i32; 2]>], offset: i32, min_angle: f64) -> usize {
    use crate::core::extract::BooleanExtractionBuffer;
    use crate::mesh::int::style::IntLineJoin;
    use i_float::int::angle::Angle;

    let join = match Angle::from_radians(min_angle) {
        Some(angle) => IntLineJoin::Miter(angle),
        None => IntLineJoin::Bevel,
    };
    let style = IntOutlineStyle::<i32>::new(offset).line_join(join);
    let mut options = IntOverlayOptions::<u64>::default();
    options.min_output_area = 0;
    let mut outer = OutlineBuilder::new(
        style.outer_offset,
        Join::<i32, IntegerMath>::new(style.join, style.miter_min_turn),
    );
    let mut inner = OutlineBuilder::new(
        style.inner_offset,
        Join::<i32, IntegerMath>::new(style.join, style.miter_min_turn),
    );
    let mut now = Overlay::new_custom(0, options, Default::default());
    let mut before = Overlay::new_custom(0, options, Default::default());
    let (mut segments, mut extraction) = (Vec::new(), BooleanExtractionBuffer::default());
    let (mut ours, mut theirs) = (FlatContoursBuffer::default(), FlatContoursBuffer::default());
    let mut count = 0;
    for path in paths {
        let path: Vec<IntPoint<i32>> = path.iter().map(|p| IntPoint::new(p[0], p[1])).collect();
        let area = path.iter().copied().area_two();
        if path.len() < 3 || area == 0 {
            continue;
        }
        let (builder, direction, fill) = if area > 0 {
            (&mut outer, ContourDirection::CounterClockwise, FillRule::Positive)
        } else {
            (&mut inner, ContourDirection::Clockwise, FillRule::Negative)
        };
        segments.clear();
        builder.build(path.iter().copied(), &mut segments);
        for overlay in [&mut now, &mut before] {
            overlay.options.output_direction = direction;
            overlay.clear();
            overlay.add_segments(&segments);
        }
        now.overlay_into(OverlayRule::Subject, fill, &mut ours);
        theirs.clear_and_reserve(0, 0);
        if let Some(graph) = before.build_graph_view(fill) {
            graph.extract_contours_into(OverlayRule::Subject, &mut extraction, &mut theirs);
        }
        assert_eq!(ours.points, theirs.points, "a path of {} points offset by {offset}", path.len());
        assert_eq!(ours.ranges, theirs.ranges, "a path of {} points offset by {offset}", path.len());
        count += ours.ranges.len();
    }
    count
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mesh::int::outline::offset::IntOutlineOffset;
    use alloc::vec;
    use core::cell::Cell;

    #[test]
    fn cloned_path_iterators_match_resource_outlines() {
        let paths = vec![
            vec![],
            vec![IntPoint::new(0, 0), IntPoint::new(0, 0)],
            vec![
                IntPoint::new(0, 0),
                IntPoint::new(1024, 0),
                IntPoint::new(2048, 0),
            ],
            vec![
                IntPoint::new(0, 0),
                IntPoint::new(0, 0),
                IntPoint::new(8192, 0),
                IntPoint::new(8192, 8192),
                IntPoint::new(0, 8192),
            ],
            vec![
                IntPoint::new(2048, 2048),
                IntPoint::new(2048, 6144),
                IntPoint::new(6144, 6144),
                IntPoint::new(6144, 2048),
            ],
        ];
        let style = IntOutlineStyle::new(1024);
        let expected = paths.outline(&style).unwrap();

        let visited = Cell::new(0);
        let paths_visited = Cell::new(0);
        let iter = paths.iter().map(|path| {
            paths_visited.set(paths_visited.get() + 1);
            path.iter().copied().inspect(|_| {
                visited.set(visited.get() + 1);
            })
        });

        let actual = iter
            .build_overlay(&style, Default::default())
            .overlay(OverlayRule::Subject, FillRule::Positive);
        assert_eq!(actual, expected);
        assert_eq!(paths_visited.get(), paths.len());
        // Short paths are skipped; zero-area paths need only the area pass.
        assert_eq!(
            visited.get(),
            paths[2].len() + 2 * (paths[3].len() + paths[4].len())
        );
    }
}
