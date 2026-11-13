//! The command line: slices STL and 3MF files into a `.gcode.3mf` with the app's default settings, or with a slice
//! setup the app made from people's slicing settings.

use spaghetti_slicer::{Input, Options, Plate, gcode, setup};
use std::process::ExitCode;

const USAGE: &str = "Usage: spaghetti-slicer [options] <model.stl|model.3mf>...

Slices the models with Spaghetti's defaults (Bambu Lab X2D, 0.4 mm nozzle, 0.20 mm Standard, PLA on the Textured
PEI plate), or with a slice setup, into a .gcode.3mf for Spaghetti's 3D view and the printer: its start and end
G-code are the X2D's own, filled as OrcaSlicer fills them. It is new: watch its first prints.

Options:
      --setup <file>    Slice with a slice setup (JSON): the configs the app's sliceSetup makes from its slicing
                        settings, as it hands them to Orca's engine (bench/setup.mts writes one)
  -o, --output <file>   The .gcode.3mf to write (default: the first model's name with .gcode.3mf)
      --gcode <file>    Also write the plain G-code
      --stats <file>    Write the statistics as JSON (time, filament, per feature, per layer)
      --keep-placement  Keep the objects where the files put them instead of arranging them on the plate
      --no-thumbnail    Leave out the plate picture
      --timings         Print how long each step took
  -h, --help            Show this";

struct Args {
    inputs: Vec<String>,
    setup: Option<String>,
    output: Option<String>,
    gcode: Option<String>,
    stats: Option<String>,
    keep_placement: bool,
    thumbnail: bool,
    timings: bool,
}

fn parse(args: Vec<String>) -> Result<Args, String> {
    let mut out = Args {
        inputs: vec![],
        setup: None,
        output: None,
        gcode: None,
        stats: None,
        keep_placement: false,
        thumbnail: true,
        timings: false,
    };
    let mut it = args.into_iter();
    while let Some(arg) = it.next() {
        let mut value = |name: &str| it.next().ok_or_else(|| format!("{name} needs a file"));
        match arg.as_str() {
            "--setup" => out.setup = Some(value(&arg)?),
            "-o" | "--output" => out.output = Some(value(&arg)?),
            "--gcode" => out.gcode = Some(value(&arg)?),
            "--stats" => out.stats = Some(value(&arg)?),
            "--keep-placement" => out.keep_placement = true,
            "--no-thumbnail" => out.thumbnail = false,
            "--timings" => out.timings = true,
            "-h" | "--help" => return Err(String::new()),
            a if a.starts_with('-') => return Err(format!("unknown option {a}")),
            _ => out.inputs.push(arg),
        }
    }
    if out.inputs.is_empty() {
        return Err("no model to slice".into());
    }
    Ok(out)
}

fn main() -> ExitCode {
    let args = match parse(std::env::args().skip(1).collect()) {
        Ok(a) => a,
        Err(message) if message.is_empty() => {
            println!("{USAGE}");
            return ExitCode::SUCCESS;
        }
        Err(message) => {
            eprintln!("{message}\n\n{USAGE}");
            return ExitCode::from(2);
        }
    };
    let setup = match &args.setup {
        None => setup::Setup::default(),
        Some(path) => match std::fs::read_to_string(path).map_err(|e| e.to_string()) {
            Err(e) => {
                eprintln!("can't read {path}: {e}");
                return ExitCode::FAILURE;
            }
            Ok(text) => match setup::read(&text) {
                Ok(setup) => setup,
                Err(e) => {
                    eprintln!("{path}: {e}");
                    return ExitCode::FAILURE;
                }
            },
        },
    };
    let settings = setup.settings;
    let options = Options { arrange: !args.keep_placement, thumbnail: args.thumbnail, scale: setup.scale };
    // One file at a time: each file's bytes go once it is read.
    let mut plate = Plate::default();
    for path in &args.inputs {
        let bytes = match std::fs::read(path) {
            Ok(bytes) => bytes,
            Err(e) => {
                eprintln!("can't read {path}: {e}");
                return ExitCode::FAILURE;
            }
        };
        if let Err(e) = plate.add(&Input { name: path, bytes: &bytes }) {
            eprintln!("can't slice {path}: {e}");
            return ExitCode::FAILURE;
        }
    }
    let out = match plate.slice(&settings, &options) {
        Ok(out) => out,
        Err(e) => {
            eprintln!("can't slice: {e}");
            return ExitCode::FAILURE;
        }
    };
    let output = args.output.clone().unwrap_or_else(|| {
        let first = &args.inputs[0];
        let stem = first.rsplit_once('.').map(|(s, _)| s).unwrap_or(first);
        format!("{stem}.gcode.3mf")
    });
    let mut writes = vec![(output.clone(), out.file.as_slice())];
    if let Some(g) = &args.gcode {
        writes.push((g.clone(), out.gcode.as_slice()));
    }
    let stats = out.stats.json(&settings);
    if let Some(s) = &args.stats {
        writes.push((s.clone(), stats.as_bytes()));
    }
    for (path, bytes) in writes {
        if let Err(e) = std::fs::write(&path, bytes) {
            eprintln!("can't write {path}: {e}");
            return ExitCode::FAILURE;
        }
    }
    let s = &out.stats;
    println!(
        "{output}: {} layers, {} ({} printing), {:.2} g of filament ({:.2} m); {} bytes",
        s.layers,
        gcode::duration(s.total_time),
        gcode::duration(s.model_time),
        s.weight,
        s.filament_mm / 1000.0,
        out.file.len()
    );
    for fallback in &out.fallbacks {
        eprintln!("note: {fallback}");
    }
    if args.timings {
        let t = &out.timings;
        eprintln!(
            "{} triangles: read {:.1} ms, slice {:.1}, regions {:.1}, supports {:.1}, toolpaths {:.1}, gcode {:.1}, picture {:.1}, pack {:.1}; total {:.1} ms",
            out.triangles, t.read, t.slice, t.regions, t.supports, t.toolpaths, t.gcode, t.thumbnail, t.pack, t.total
        );
    }
    ExitCode::SUCCESS
}
