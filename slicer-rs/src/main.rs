//! The command line: slices STL and 3MF files into a `.gcode.3mf` with the app's default settings, or with a slice
//! setup the app made from people's slicing settings.

use spaghetti_slicer::{Input, Options, Plate, gcode, profile, setup};
use std::process::ExitCode;

const USAGE: &str = "Usage: spaghetti-slicer [options] <model.stl|model.3mf>...

Slices the models with Spaghetti's defaults (Bambu Lab X2D, 0.4 mm nozzle, 0.20 mm Standard, PLA on the Textured
PEI plate), or with a slice setup, into a .gcode.3mf for Spaghetti's 3D view and the printer: its start and end
G-code are the X2D's own, filled as OrcaSlicer fills them. It is new: watch its first prints.

Options:
      --setup <file>    Slice with a slice setup (JSON): the configs the app's sliceSetup makes from its slicing
                        settings, as it hands them to Orca's engine (bench/setup.mts writes one)
      --nozzle <mm>     Slice for the X2D's 0.2, 0.6 or 0.8 mm nozzle instead of its 0.4, with Bambu's presets for
                        it (its Standard process and Bambu PLA Basic), which a setup is laid over
  -o, --output <file>   The .gcode.3mf to write (default: the first model's name with .gcode.3mf)
      --gcode <file>    Also write the plain G-code
      --stats <file>    Write the statistics as JSON (time, filament, per feature, per layer)
      --filaments <n,…> Print each model in a filament (1, 2, …; one per model, in order): a plate in several
                        filaments prints as the X2D does with the AMS, changing filament over a prime tower
      --filament-map <n,…> Which nozzle prints each filament (1 the left, 2 the right), as Orca's manual
                        grouping; by default Orca's own grouping chooses
      --keep-placement  Keep the objects where the files put them instead of arranging them on the plate
      --no-thumbnail    Leave out the plate picture
      --timings         Print how long each step took
  -h, --help            Show this";

struct Args {
    inputs: Vec<String>,
    setup: Option<String>,
    nozzle: Option<f64>,
    output: Option<String>,
    gcode: Option<String>,
    stats: Option<String>,
    keep_placement: bool,
    thumbnail: bool,
    timings: bool,
    /// Each input's filament (1-based), when given.
    filaments: Vec<usize>,
    /// Each filament's nozzle (1-based), when given.
    filament_map: Option<Vec<usize>>,
}

fn parse(args: Vec<String>) -> Result<Args, String> {
    let mut out = Args {
        inputs: vec![],
        setup: None,
        nozzle: None,
        output: None,
        gcode: None,
        stats: None,
        keep_placement: false,
        thumbnail: true,
        timings: false,
        filaments: vec![],
        filament_map: None,
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
            "--nozzle" => {
                let mm = it.next().ok_or_else(|| "--nozzle needs a width in mm".to_string())?;
                let width = mm.parse::<f64>().ok().filter(|&w| profile::x2d_nozzle(w).is_some());
                out.nozzle = Some(width.ok_or_else(|| format!("--nozzle takes 0.2, 0.4, 0.6 or 0.8, not {mm}"))?);
            }
            "--filaments" => {
                let list = it.next().ok_or_else(|| "--filaments needs a list".to_string())?;
                out.filaments = list
                    .split(',')
                    .map(|v| v.trim().parse::<usize>().ok().filter(|&n| (1..=16).contains(&n)))
                    .collect::<Option<_>>()
                    .ok_or_else(|| format!("--filaments takes numbers from 1 to 16, not {list}"))?;
            }
            "--filament-map" => {
                let list = it.next().ok_or_else(|| "--filament-map needs a list".to_string())?;
                let map = list
                    .split(',')
                    .map(|v| v.trim().parse::<usize>().ok().filter(|&n| (1..=2).contains(&n)))
                    .collect::<Option<_>>()
                    .ok_or_else(|| format!("--filament-map takes nozzles 1 and 2, not {list}"))?;
                out.filament_map = Some(map);
            }
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
    // The nozzle's presets, which a setup is laid over.
    let base = args.nozzle.and_then(profile::x2d_nozzle).unwrap_or_else(profile::x2d);
    let setup = match &args.setup {
        None => match setup::read_over("{}", &base) {
            Ok(setup) => setup,
            Err(e) => {
                eprintln!("can't slice with the presets for the {} mm nozzle: {e}", args.nozzle.unwrap_or(0.4));
                return ExitCode::FAILURE;
            }
        },
        Some(path) => match std::fs::read_to_string(path).map_err(|e| e.to_string()) {
            Err(e) => {
                eprintln!("can't read {path}: {e}");
                return ExitCode::FAILURE;
            }
            Ok(text) => match setup::read_over(&text, &base) {
                Ok(setup) => setup,
                Err(e) => {
                    eprintln!("{path}: {e}");
                    return ExitCode::FAILURE;
                }
            },
        },
    };
    let mut settings = setup.settings;
    // Models in several filaments with no setup to say what they are: the presets' filament for each.
    let count = args.filaments.iter().copied().max().unwrap_or(1);
    if count > 1 && settings.palette.as_ref().is_none_or(|p| p.profiles.len() < count) {
        settings.palette = Some(std::sync::Arc::new(spaghetti_slicer::filaments::palette_of(&settings, count)));
    }
    if let (Some(map), Some(palette)) = (&args.filament_map, &mut settings.palette) {
        std::sync::Arc::make_mut(palette).manual_map = Some(map.iter().map(|n| n - 1).collect());
    }
    let options = Options { arrange: !args.keep_placement, thumbnail: args.thumbnail, scale: setup.scale };
    // One file at a time: each file's bytes go once it is read.
    let mut plate = Plate::default();
    for (k, path) in args.inputs.iter().enumerate() {
        let bytes = match std::fs::read(path) {
            Ok(bytes) => bytes,
            Err(e) => {
                eprintln!("can't read {path}: {e}");
                return ExitCode::FAILURE;
            }
        };
        let filament = args.filaments.get(k).map(|f| f - 1);
        if let Err(e) = plate.add_with_filament(&Input { name: path, bytes: &bytes }, filament) {
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
