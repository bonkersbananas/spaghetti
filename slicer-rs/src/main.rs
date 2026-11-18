//! The command line: slices STL and 3MF files into a `.gcode.3mf` with the app's default settings, or with a slice
//! setup the app made from people's slicing settings.

use spaghetti_slicer::{Input, Options, Output, Plate, Settings, gcode, profile, setup};
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
      --parts           Slice the models as the parts of one object (each in its --filaments filament), as Orca
                        prints an object made of parts: where two overlap, the later one's
      --keep-placement  Keep the objects where the files put them instead of arranging them on the plate
      --job <file>      Replay what the app handed the WebAssembly module (bench/app-slice.mts writes it): its
                        setup, then each object or part with its filament and paint, kept where they are
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
    /// Whether the models are the parts of one object.
    parts: bool,
    thumbnail: bool,
    timings: bool,
    /// Each input's filament (1-based), when given.
    filaments: Vec<usize>,
    /// Each filament's nozzle (1-based), when given.
    filament_map: Option<Vec<usize>>,
    /// A job to replay (bench/app-slice.mts), in place of models.
    job: Option<String>,
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
        parts: false,
        thumbnail: true,
        timings: false,
        filaments: vec![],
        filament_map: None,
        job: None,
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
            "--parts" => out.parts = true,
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
            "--job" => out.job = Some(value(&arg)?),
            "--no-thumbnail" => out.thumbnail = false,
            "--timings" => out.timings = true,
            "-h" | "--help" => return Err(String::new()),
            a if a.starts_with('-') => return Err(format!("unknown option {a}")),
            _ => out.inputs.push(arg),
        }
    }
    if out.inputs.is_empty() && out.job.is_none() {
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
    if let Some(job) = &args.job {
        return replay(job, &args);
    }
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
        let palette = spaghetti_slicer::filaments::palette_of(&settings, count);
        settings.set_palette(Some(std::sync::Arc::new(palette)));
    }
    if let (Some(map), Some(palette)) = (&args.filament_map, &mut settings.palette) {
        std::sync::Arc::make_mut(palette).manual_map = Some(map.iter().map(|n| n - 1).collect());
    }
    let options = Options {
        arrange: !args.keep_placement,
        thumbnail: args.thumbnail,
        scale: setup.scale,
        gcode: args.gcode.is_some(),
    };
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
        let input = Input { name: path, bytes: &bytes };
        let added = if args.parts {
            plate.add_part(&input, filament.unwrap_or(0), k == 0)
        } else {
            plate.add_with_filament(&input, filament)
        };
        if let Err(e) = added {
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
    match write_out(&out, &settings, &output, &args) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("{e}");
            ExitCode::FAILURE
        }
    }
}

/// Writes the slice's files (the `.gcode.3mf`, and the G-code and statistics when asked for) and says what it made.
fn write_out(out: &Output, settings: &Settings, output: &str, args: &Args) -> Result<(), String> {
    let mut writes = vec![(output.to_string(), out.file.as_slice())];
    if let Some(g) = &args.gcode {
        writes.push((g.clone(), out.gcode.as_slice()));
    }
    let stats = out.stats.json(settings);
    if let Some(s) = &args.stats {
        writes.push((s.clone(), stats.as_bytes()));
    }
    for (path, bytes) in writes {
        std::fs::write(&path, bytes).map_err(|e| format!("can't write {path}: {e}"))?;
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
    for warning in &out.warnings {
        eprintln!("warning: {}", warning.message);
    }
    if args.timings {
        let t = &out.timings;
        eprintln!(
            "{} triangles: read {:.1} ms, slice {:.1}, regions {:.1}, supports {:.1}, toolpaths {:.1}, gcode {:.1}, picture {:.1}, pack {:.1}; total {:.1} ms",
            out.triangles, t.read, t.slice, t.regions, t.supports, t.toolpaths, t.gcode, t.thumbnail, t.pack, t.total
        );
    }
    Ok(())
}

/// Slices what the app handed the WebAssembly module, as `bench/app-slice.mts` wrote it down: the setup read as the
/// module reads it, then each call (`add`, `add_in` or `add_part`, with an STL and its paint), the objects kept where
/// they are. The file is the module's, byte for byte.
fn replay(path: &str, args: &Args) -> ExitCode {
    use spaghetti_slicer::json::{self, Json};
    use spaghetti_slicer::paint::Paint;
    let dir = std::path::Path::new(path).parent().unwrap_or(std::path::Path::new("."));
    let read = |name: &str| std::fs::read(dir.join(name)).map_err(|e| format!("can't read {name}: {e}"));
    let run = || -> Result<(), String> {
        let text = String::from_utf8(std::fs::read(path).map_err(|e| format!("can't read {path}: {e}"))?)
            .map_err(|_| "the job isn't UTF-8".to_string())?;
        let Some(Json::Object(job)) = json::parse(&text) else { return Err("the job isn't JSON".into()) };
        let text = |v: Option<&Json>| v.and_then(Json::as_str).map(str::to_string);
        let number = |v: Option<&Json>| match v {
            Some(Json::Number(n)) => Some(*n as usize),
            _ => None,
        };
        let setup_name = text(job.get("setup")).ok_or("the job names no setup")?;
        let setup_text = String::from_utf8(read(&setup_name)?).map_err(|_| "the setup isn't UTF-8".to_string())?;
        let setup = setup::read(&setup_text).map_err(|e| format!("{setup_name}: {e}"))?;
        let mut plate = Plate::default();
        let Some(Json::Array(calls)) = job.get("calls") else { return Err("the job has no calls".into()) };
        for call in calls {
            let Json::Object(call) = call else { return Err("a call isn't an object".into()) };
            let op = text(call.get("op")).unwrap_or_default();
            let name = text(call.get("name")).unwrap_or_default();
            let stl = text(call.get("stl")).ok_or("a call names no STL")?;
            let bytes = read(&stl)?;
            let input = Input { name: &name, bytes: &bytes };
            let filament = number(call.get("filament")).unwrap_or(1).max(1) - 1;
            match op.as_str() {
                "add" => plate.add(&input),
                "add_in" => plate.add_with_filament(&input, Some(filament)),
                "add_part" => plate.add_part(&input, filament, matches!(call.get("first"), Some(Json::Bool(true)))),
                other => return Err(format!("unknown call {other}")),
            }
            .map_err(|e| format!("can't slice {name}: {e}"))?;
            for key in ["paint", "supports", "seams"] {
                if let Some(file) = text(call.get(key)) {
                    let paint = Paint::from_bytes(&read(&file)?).ok_or_else(|| format!("{file} isn't paint"))?;
                    let taken = match key {
                        "paint" => plate.paint(&paint),
                        "supports" => plate.paint_supports(&paint),
                        _ => plate.paint_seams(&paint),
                    };
                    if !taken {
                        return Err(format!("{file} isn't paint for {stl}"));
                    }
                }
            }
        }
        let options =
            Options { arrange: false, thumbnail: args.thumbnail, scale: setup.scale, gcode: args.gcode.is_some() };
        let out = plate.slice(&setup.settings, &options).map_err(|e| format!("can't slice: {e}"))?;
        let output = args.output.clone().unwrap_or_else(|| "job.gcode.3mf".into());
        write_out(&out, &setup.settings, &output, args)
    };
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("{e}");
            ExitCode::FAILURE
        }
    }
}
