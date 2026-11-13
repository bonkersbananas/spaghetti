//! The WebAssembly entry points: a plain C ABI, no bindings. For each model file the host copies its name (UTF-8) and
//! its bytes into memory from `alloc`, calls `add` and frees them with `dealloc`; then it calls `slice` and reads the
//! `.gcode.3mf` and a JSON summary from `output_ptr`/`output_len` and `summary_ptr`/`summary_len`. To slice with
//! other settings than the X2D's defaults, it first hands `setup` a slice setup (`setup.rs`: the JSON the app's
//! `sliceSetup` makes, as it hands Orca's engine), which holds until the next one. It provides one import,
//! `env.now_ms`, a clock in milliseconds.

use crate::setup::{self, Setup};
use crate::{Error, Input, Options, Plate};
use std::cell::RefCell;

#[link(wasm_import_module = "env")]
unsafe extern "C" {
    fn now_ms() -> f64;
}

pub fn now() -> f64 {
    // SAFETY: the host provides the clock; it takes nothing and returns a number.
    unsafe { now_ms() }
}

thread_local! {
    static PLATE: RefCell<Plate> = RefCell::new(Plate::default());
    static SETUP: RefCell<Setup> = RefCell::new(Setup::default());
    static OUTPUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    static SUMMARY: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

/// Room for `len` bytes of input.
#[unsafe(no_mangle)]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut buf = Vec::<u8>::with_capacity(len);
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

/// Gives back what `alloc` lent.
///
/// # Safety
/// `ptr` and `len` must come from one `alloc` call, freed once.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    // SAFETY: the caller passes back exactly what alloc made.
    unsafe { drop(Vec::from_raw_parts(ptr, 0, len)) };
}

/// An error as a number for the host: 1 unreadable, 2 no model, 3 too big, 4 too tall, 5 too many, 6 for a name
/// that isn't UTF-8, 7 a setup that isn't one, 8 settings this can't slice yet. The summary then says it in words:
/// `{"error": "can't slice with supports yet"}`.
fn code(e: Error) -> u32 {
    SUMMARY.with(|s| *s.borrow_mut() = format!(r#"{{"error":{}}}"#, crate::pack::json(&e.to_string())).into_bytes());
    match e {
        Error::Unreadable => 1,
        Error::NoModel => 2,
        Error::TooBig => 3,
        Error::TooTall => 4,
        Error::TooMany => 5,
        Error::Setup => 7,
        Error::Unsupported(_) => 8,
    }
}

/// Takes a slice setup (JSON, UTF-8) for the slices that follow: its `len` bytes at `data`, written by the host
/// after `alloc`. Returns 0, or an error code (see `code`); a refused setup leaves the one before in place.
///
/// # Safety
/// `data` must point at `len` bytes the host wrote after `alloc`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn setup(data: *const u8, len: usize) -> u32 {
    // SAFETY: the host wrote `len` bytes at `data`.
    let Ok(text) = std::str::from_utf8(unsafe { std::slice::from_raw_parts(data, len) }) else {
        return code(Error::Setup);
    };
    match setup::read(text) {
        Ok(s) => {
            SETUP.with(|current| *current.borrow_mut() = s);
            0
        }
        Err(e) => code(e),
    }
}

/// Reads one model file onto the plate: its name at `name` and its bytes at `data`, written by the host after
/// `alloc`. Returns 0, or an error code (see `code`). The host can free both once this returns.
///
/// # Safety
/// `name` and `data` must point at `name_len` and `data_len` bytes the host wrote after `alloc`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn add(name: *const u8, name_len: usize, data: *const u8, data_len: usize) -> u32 {
    // SAFETY: the host wrote `name_len` bytes at `name`.
    let Ok(name) = std::str::from_utf8(unsafe { std::slice::from_raw_parts(name, name_len) }) else { return 6 };
    // SAFETY: the host wrote `data_len` bytes at `data`.
    let bytes = unsafe { std::slice::from_raw_parts(data, data_len) };
    PLATE.with(|p| p.borrow_mut().add(&Input { name, bytes })).map_or_else(code, |()| 0)
}

/// Slices the models added since the last `slice` or `clear`. Flags: bit 0 keeps the objects where the files put
/// them; bit 1 leaves out the picture. Returns 0 when it made a file, else an error code (see `code`).
#[unsafe(no_mangle)]
pub extern "C" fn slice(flags: u32) -> u32 {
    let plate = PLATE.with(|p| std::mem::take(&mut *p.borrow_mut()));
    let Setup { settings, scale } = SETUP.with(|s| s.borrow().clone());
    let options = Options { arrange: flags & 1 == 0, thumbnail: flags & 2 == 0, scale };
    match plate.slice(&settings, &options) {
        Ok(out) => {
            let t = &out.timings;
            let summary = format!(
                r#"{{"triangles":{},"timings":{{"read":{:.3},"slice":{:.3},"regions":{:.3},"toolpaths":{:.3},"gcode":{:.3},"thumbnail":{:.3},"pack":{:.3},"total":{:.3}}},"gcodeBytes":{},"fallbacks":[{}],"stats":{}}}"#,
                out.triangles,
                t.read,
                t.slice,
                t.regions,
                t.toolpaths,
                t.gcode,
                t.thumbnail,
                t.pack,
                t.total,
                out.gcode.len(),
                out.fallbacks.iter().map(|f| crate::pack::json(f)).collect::<Vec<_>>().join(","),
                out.stats.json(&settings)
            );
            OUTPUT.with(|o| *o.borrow_mut() = out.file);
            SUMMARY.with(|s| *s.borrow_mut() = summary.into_bytes());
            0
        }
        Err(e) => code(e),
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn output_ptr() -> *const u8 {
    OUTPUT.with(|o| o.borrow().as_ptr())
}

#[unsafe(no_mangle)]
pub extern "C" fn output_len() -> usize {
    OUTPUT.with(|o| o.borrow().len())
}

#[unsafe(no_mangle)]
pub extern "C" fn summary_ptr() -> *const u8 {
    SUMMARY.with(|s| s.borrow().as_ptr())
}

#[unsafe(no_mangle)]
pub extern "C" fn summary_len() -> usize {
    SUMMARY.with(|s| s.borrow().len())
}

/// Frees the last result, and any models added but not sliced.
#[unsafe(no_mangle)]
pub extern "C" fn clear() {
    PLATE.with(|p| *p.borrow_mut() = Plate::default());
    OUTPUT.with(|o| *o.borrow_mut() = Vec::new());
    SUMMARY.with(|s| *s.borrow_mut() = Vec::new());
}
