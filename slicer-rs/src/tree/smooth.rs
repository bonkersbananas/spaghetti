//! Placeholder until the port of Orca's `smooth_outward` lands: returns the shapes as they are.

use crate::geom::Shapes;

/// Orca's `smooth_outward` (placeholder).
pub fn smooth_outward(shapes: &Shapes, _clip_dist_nm: i64) -> Shapes {
    shapes.clone()
}
