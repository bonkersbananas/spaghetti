//! Prototype: a fork-join pool on WebAssembly threads (shared memory, atomics). The host starts Web Workers that
//! instantiate this module on the same memory and call `pool_worker`, which never returns; `par::map_range` hands
//! them indices. One job at a time; a job started from inside a job runs on its own thread.
use core::arch::wasm32::{memory_atomic_notify, memory_atomic_wait32};
use core::mem::MaybeUninit;
use core::sync::atomic::{AtomicI32, AtomicU32, AtomicU64, AtomicUsize, Ordering::*};
use std::cell::Cell;

type Run = unsafe fn(*const (), usize);

static RUN: AtomicUsize = AtomicUsize::new(0);
static DATA: AtomicUsize = AtomicUsize::new(0);
static N: AtomicUsize = AtomicUsize::new(0);
/// Job number in the high half, next index in the low half.
static STATE: AtomicU64 = AtomicU64::new(0);
static DONE: AtomicU32 = AtomicU32::new(0);
static EPOCH: AtomicI32 = AtomicI32::new(0);
static WORKERS: AtomicUsize = AtomicUsize::new(0);

thread_local! { static BUSY: Cell<bool> = const { Cell::new(false) }; }

/// Takes indices of job `epoch` until there are none.
fn work(epoch: u32) {
    loop {
        let s = STATE.load(Acquire);
        if (s >> 32) as u32 != epoch {
            return;
        }
        let i = s as u32 as usize;
        if i >= N.load(Acquire) {
            return;
        }
        if STATE.compare_exchange(s, s + 1, AcqRel, Acquire).is_err() {
            continue;
        }
        // SAFETY: the job's function and data were set before its number was published, and stay until all N are done.
        unsafe {
            let run: Run = core::mem::transmute::<usize, Run>(RUN.load(Acquire));
            run(DATA.load(Acquire) as *const (), i);
        }
        if DONE.fetch_add(1, AcqRel) + 1 == N.load(Acquire) as u32 {
            unsafe { memory_atomic_notify(DONE.as_ptr() as *mut i32, 1) };
        }
    }
}

/// The body of a worker thread: the host calls it once per Web Worker, after setting up its stack and thread-local storage.
#[unsafe(no_mangle)]
pub extern "C" fn pool_worker() {
    WORKERS.fetch_add(1, AcqRel);
    BUSY.with(|b| b.set(true));
    let mut seen = EPOCH.load(Acquire);
    loop {
        unsafe { memory_atomic_wait32(EPOCH.as_ptr(), seen, -1) };
        let e = EPOCH.load(Acquire);
        if e != seen {
            seen = e;
            work(e as u32);
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn pool_workers() -> usize {
    WORKERS.load(Acquire)
}

struct Task<'a, T, F> {
    f: &'a F,
    out: *mut MaybeUninit<T>,
}

unsafe fn trampoline<T, F: Fn(usize) -> T>(data: *const (), i: usize) {
    let task = unsafe { &*(data as *const Task<T, F>) };
    unsafe { (*task.out.add(i)).write((task.f)(i)) };
}

pub fn map_range<T: Send, F: Fn(usize) -> T + Sync + Send>(n: usize, f: F) -> Vec<T> {
    let serial = n < 2 || WORKERS.load(Acquire) == 0 || BUSY.with(|b| b.get());
    if serial {
        return (0..n).map(f).collect();
    }
    let mut out: Vec<MaybeUninit<T>> = Vec::with_capacity(n);
    let task = Task { f: &f, out: out.as_mut_ptr() };
    BUSY.with(|b| b.set(true));
    RUN.store(trampoline::<T, F> as Run as usize, Release);
    DATA.store(&task as *const _ as usize, Release);
    N.store(n, Release);
    DONE.store(0, Release);
    let epoch = EPOCH.load(Acquire).wrapping_add(1);
    STATE.store(((epoch as u32 as u64) << 32), Release);
    EPOCH.store(epoch, Release);
    unsafe { memory_atomic_notify(EPOCH.as_ptr(), u32::MAX) };
    work(epoch as u32);
    loop {
        let d = DONE.load(Acquire);
        if d as usize == n {
            break;
        }
        unsafe { memory_atomic_wait32(DONE.as_ptr() as *mut i32, d as i32, -1) };
    }
    BUSY.with(|b| b.set(false));
    // SAFETY: every slot was written once.
    unsafe {
        out.set_len(n);
        core::mem::transmute::<Vec<MaybeUninit<T>>, Vec<T>>(out)
    }
}

pub fn join<A: Send, B: Send>(a: impl FnOnce() -> A + Send, b: impl FnOnce() -> B + Send) -> (A, B) {
    use std::sync::Mutex;
    let a = Mutex::new(Some(a));
    let b = Mutex::new(Some(b));
    let ra = Mutex::new(None);
    let rb = Mutex::new(None);
    map_range(2, |i| {
        if i == 0 {
            *ra.lock().unwrap() = Some((a.lock().unwrap().take().unwrap())());
        } else {
            *rb.lock().unwrap() = Some((b.lock().unwrap().take().unwrap())());
        }
    });
    (ra.into_inner().unwrap().unwrap(), rb.into_inner().unwrap().unwrap())
}
