//! The WebAssembly entry points: a plain C ABI, no bindings. For each model file the host copies its name (UTF-8) and
//! its bytes into memory from `alloc`, calls `add` and frees them with `dealloc`; then it calls `slice` and reads the
//! `.gcode.3mf` and a JSON summary from `output_ptr`/`output_len` and `summary_ptr`/`summary_len`. It provides one
//! import, `env.now_ms`, a clock in milliseconds.

use crate::{Error, Input, Options, Plate, Settings};
use std::cell::RefCell;

#[link(wasm_import_module = "env")]
unsafe extern "C" {
    fn now_ms() -> f64;
}

pub fn now() -> f64 {
    // SAFETY: the host provides the clock; it takes nothing and returns a number.
    unsafe { now_ms() }
}

/// getrandom's source in WebAssembly (see `.cargo/config.toml`): a fixed xorshift sequence. Only boostvoronoi's
/// skip list draws on it, to balance itself, so any numbers do, and the same ones keep the output the same.
///
/// # Safety
/// `dest` must point at `len` writable bytes (getrandom's contract).
#[unsafe(no_mangle)]
unsafe extern "Rust" fn __getrandom_v03_custom(dest: *mut u8, len: usize) -> Result<(), getrandom::Error> {
    use std::sync::atomic::{AtomicU64, Ordering::Relaxed};
    static STATE: AtomicU64 = AtomicU64::new(0x9E37_79B9_7F4A_7C15);
    // SAFETY: getrandom hands over `len` writable bytes at `dest`.
    let out = unsafe { std::slice::from_raw_parts_mut(dest, len) };
    for chunk in out.chunks_mut(8) {
        let mut x = STATE.load(Relaxed);
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        STATE.store(x, Relaxed);
        chunk.copy_from_slice(&x.to_le_bytes()[..chunk.len()]);
    }
    Ok(())
}

thread_local! {
    static PLATE: RefCell<Plate> = RefCell::new(Plate::default());
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

/// An error as a number for the host: 1 unreadable, 2 no model, 3 too big, 4 too tall, 5 too many (and 6 for a name
/// that isn't UTF-8).
fn code(e: Error) -> u32 {
    match e {
        Error::Unreadable => 1,
        Error::NoModel => 2,
        Error::TooBig => 3,
        Error::TooTall => 4,
        Error::TooMany => 5,
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
    let settings = Settings::default();
    let options = Options { arrange: flags & 1 == 0, thumbnail: flags & 2 == 0 };
    match plate.slice(&settings, &options) {
        Ok(out) => {
            let t = &out.timings;
            let summary = format!(
                r#"{{"triangles":{},"timings":{{"read":{:.3},"slice":{:.3},"regions":{:.3},"toolpaths":{:.3},"gcode":{:.3},"thumbnail":{:.3},"pack":{:.3},"total":{:.3}}},"gcodeBytes":{},"stats":{}}}"#,
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
