//! Rafts as OrcaSlicer 2.5 builds them (its `SlicingParameters`, `generate_raft_base` and the raft's part of
//! `generate_support_toolpaths`): layers of support under the whole object, which then starts higher up.
//!
//! A raft of n layers has (n + 1) / 2 of interface on top and the rest of base below: the first layer as thick as
//! any first layer, the others three quarters of the nozzle (or the layer height, if more), the last the contact
//! layer the object rests on, a small gap below it (`raft_contact_distance`). The object's layers start over that gap
//! at its own layer height, and its first one is no longer a first layer: it prints at its usual widths and speeds,
//! with no elephant's foot compensation and no brim. The support generator (`support.rs`) makes the raft's areas: the
//! contact layer the object's first layer grown by `raft_expansion`, put on Orca's support grid by normal supports and
//! left as it is by organic trees (which make the raft with supports off too); the layers under it that, a little
//! wider, and on the plate wider still (`raft_first_layer_expansion`), printed at its own density.

use crate::config::Settings;

const EPSILON: f64 = 1e-4;

/// A raft's layers and where the object starts above it, mm.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Raft {
    /// Layers of base (the first layer among them) and of interface (the contact layer among them).
    pub base_layers: usize,
    pub interface_layers: usize,
    pub base_height: f64,
    pub interface_height: f64,
    pub contact_height: f64,
    /// The top of the base, of the interface under the contact layer, and of the contact layer.
    pub base_top_z: f64,
    pub interface_top_z: f64,
    pub contact_top_z: f64,
    /// The first layer's height.
    pub first_height: f64,
    /// Where the object's first layer starts: the contact layer's top and the gap above it.
    pub object_z: f64,
}

impl Raft {
    /// The raft the settings ask for (`raft_layers`), whether or not supports are on, as Orca's
    /// `SlicingParameters::create_from_config` works it out.
    pub fn of(s: &Settings) -> Option<Raft> {
        let n = usize::try_from(s.support.raft_layers).ok().filter(|&n| n > 0)?;
        let interface_layers = n.div_ceil(2);
        let base_layers = n - interface_layers;
        // The support's nozzle and its interface's: the plate's one, or the first, as Orca reads them.
        let thick = s.layer_height.max(0.75 * s.nozzle_diameter);
        let first = s.first_layer_height;
        let (base_top_z, interface_top_z, contact_height, contact_top_z) = if n == 1 {
            // The contact layer alone, on the plate.
            (0.0, 0.0, first, first)
        } else {
            let base_top_z = first + (base_layers - 1) as f64 * thick;
            let interface_top_z = base_top_z + (interface_layers - 1) as f64 * thick;
            (base_top_z, interface_top_z, thick, interface_top_z + thick)
        };
        // The gap: none where the support's top gap is none, else the raft's own, in whole layers when the support's
        // layers follow the object's.
        let sp = &s.support;
        let gap = if sp.raft_contact_distance == 0.0 || sp.top_z_distance == 0.0 {
            0.0
        } else if sp.independent_layer_height {
            sp.raft_contact_distance
        } else {
            (sp.raft_contact_distance / s.layer_height + EPSILON).round() * s.layer_height
        };
        Some(Raft {
            base_layers,
            interface_layers,
            base_height: thick,
            interface_height: thick,
            contact_height,
            base_top_z,
            interface_top_z,
            contact_top_z,
            first_height: first,
            object_z: contact_top_z + gap,
        })
    }

    /// Its layers, the contact layer among them.
    pub fn layers(&self) -> usize {
        self.base_layers + self.interface_layers
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::setup;

    fn raft(layers: &str) -> Option<Raft> {
        let json = format!(r#"{{"process": {{"raft_layers": "{layers}"}}}}"#);
        Raft::of(&setup::read(&json).unwrap().settings)
    }

    #[test]
    fn a_raft_is_its_base_its_interface_and_a_gap_under_the_object() {
        assert_eq!(raft("0"), None);
        // One layer: the contact layer alone, a first layer on the plate, and the object 0.1 mm over it.
        let one = raft("1").unwrap();
        assert_eq!((one.base_layers, one.interface_layers), (0, 1));
        assert!((one.contact_top_z - 0.2).abs() < 1e-9 && (one.object_z - 0.3).abs() < 1e-9, "{one:?}");
        // Three: the first layer (base), an interface layer and the contact layer, three quarters of the nozzle each.
        let three = raft("3").unwrap();
        assert_eq!((three.base_layers, three.interface_layers), (1, 2));
        assert!((three.base_top_z - 0.2).abs() < 1e-9, "{three:?}");
        assert!((three.interface_top_z - 0.5).abs() < 1e-9 && (three.contact_top_z - 0.8).abs() < 1e-9, "{three:?}");
        assert!((three.object_z - 0.9).abs() < 1e-9, "{three:?}");
        // Four: two of base, two of interface.
        let four = raft("4").unwrap();
        assert_eq!((four.base_layers, four.interface_layers, four.layers()), (2, 2, 4));
        assert!((four.base_top_z - 0.5).abs() < 1e-9 && (four.contact_top_z - 1.1).abs() < 1e-9, "{four:?}");
    }
}
