//! The command line: slices STL and 3MF files into a `.gcode.3mf` with the app's default settings.

use spaghetti_slicer::{Input, Options, Plate, Settings, gcode};
use std::process::ExitCode;

const USAGE: &str = "Usage: spaghetti-slicer [options] <model.stl|model.3mf>...

Slices the models with Spaghetti's defaults (Bambu Lab X2D, 0.4 mm nozzle, 0.20 mm Standard, PLA on the Textured
PEI plate) into a .gcode.3mf for looking at in Spaghetti's 3D view. Not for printing yet: the start G-code is not
the X2D's.

Options:
  -o, --output <file>   The .gcode.3mf to write (default: the first model's name with .gcode.3mf)
      --gcode <file>    Also write the plain G-code
      --stats <file>    Write the statistics as JSON (time, filament, per feature, per layer)
      --keep-placement  Keep the objects where the files put them instead of arranging them on the plate
      --no-thumbnail    Leave out the plate picture
      --timings         Print how long each step took
  -h, --help            Show this";

struct Args {
    inputs: Vec<String>,
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
    let settings = Settings::default();
    let options = Options { arrange: !args.keep_placement, thumbnail: args.thumbnail };
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
    if args.timings {
        let t = &out.timings;
        eprintln!(
            "{} triangles: read {:.1} ms, slice {:.1}, regions {:.1}, toolpaths {:.1}, gcode {:.1}, picture {:.1}, pack {:.1}; total {:.1} ms",
            out.triangles, t.read, t.slice, t.regions, t.toolpaths, t.gcode, t.thumbnail, t.pack, t.total
        );
    }
    ExitCode::SUCCESS
}
