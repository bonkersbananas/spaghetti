//! The WebAssembly entry points: a plain C ABI, no bindings. The host copies its input into memory from `alloc`,
//! calls `slice`, then reads the `.gcode.3mf` and a JSON summary from `output_ptr`/`output_len` and
//! `summary_ptr`/`summary_len`. It provides one import, `env.now_ms`, a clock in milliseconds.
//!
//! The input: a little-endian u32 count of files, then per file a u32 name length, the name (UTF-8), a u32 data
//! length and the data. Flags: bit 0 keeps the objects where the files put them; bit 1 leaves out the picture.

use crate::{Input, Options, Settings};
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

fn read_u32(bytes: &[u8], at: &mut usize) -> Option<usize> {
    let v = u32::from_le_bytes(bytes.get(*at..*at + 4)?.try_into().ok()?) as usize;
    *at += 4;
    Some(v)
}

fn files(bytes: &[u8]) -> Option<Vec<(&str, &[u8])>> {
    let mut at = 0;
    let count = read_u32(bytes, &mut at)?;
    let mut out = Vec::with_capacity(count.min(1024));
    for _ in 0..count {
        let n = read_u32(bytes, &mut at)?;
        let name = std::str::from_utf8(bytes.get(at..at + n)?).ok()?;
        at += n;
        let d = read_u32(bytes, &mut at)?;
        let data = bytes.get(at..at + d)?;
        at += d;
        out.push((name, data));
    }
    Some(out)
}

/// Slices the files at `ptr` (see the module's notes). Returns 0 when it made a file, else an error code:
/// 1 unreadable, 2 no model, 3 too big, 4 too tall, 5 too many, 6 a malformed input.
///
/// # Safety
/// `ptr` must point at `len` bytes the host wrote after `alloc`.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn slice(ptr: *const u8, len: usize, flags: u32) -> u32 {
    // SAFETY: the host wrote `len` bytes at `ptr`.
    let bytes = unsafe { std::slice::from_raw_parts(ptr, len) };
    let Some(list) = files(bytes) else { return 6 };
    let inputs: Vec<Input> = list.iter().map(|(name, bytes)| Input { name, bytes }).collect();
    let settings = Settings::default();
    let options = Options { arrange: flags & 1 == 0, thumbnail: flags & 2 == 0 };
    match crate::slice(&inputs, &settings, &options) {
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
        Err(e) => match e {
            crate::Error::Unreadable => 1,
            crate::Error::NoModel => 2,
            crate::Error::TooBig => 3,
            crate::Error::TooTall => 4,
            crate::Error::TooMany => 5,
        },
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

/// Frees the last result.
#[unsafe(no_mangle)]
pub extern "C" fn clear() {
    OUTPUT.with(|o| *o.borrow_mut() = Vec::new());
    SUMMARY.with(|s| *s.borrow_mut() = Vec::new());
}
