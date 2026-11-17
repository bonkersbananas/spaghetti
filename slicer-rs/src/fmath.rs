//! Maths that WebAssembly runs slowly otherwise, with the same results.
//!
//! In WebAssembly `f64::hypot` is CORE-MATH's (Rust's own maths library), correctly rounded, but it takes three fused
//! multiply-adds, which WebAssembly lacks: each is a long call into software. [`Hyp::hyp`] takes CORE-MATH's fast path
//! with each of them worked out exactly from Dekker's products instead, and hands what that path doesn't settle
//! (special values, very different sizes, hard cases to round) to `f64::hypot` itself, so it gives the same bits,
//! several times faster. Natively `f64::hypot` is the C library's, which needn't be correctly rounded (glibc 2.41's on
//! aarch64 is an ulp off for one random pair in eight), so natively too [`Hyp::hyp`] takes the fast path, and only what
//! it leaves goes to the C library.

/// √(x² + y²) as `f64::hypot` gives it.
pub trait Hyp {
    fn hyp(self, y: Self) -> Self;
}

impl Hyp for f64 {
    #[inline]
    fn hyp(self, y: f64) -> f64 {
        if let Some(h) = hypot_fast(self, y) {
            return h;
        }
        self.hypot(y)
    }
}

/// Veltkamp's split: `a` as a high half of 26 bits and the rest, exactly.
#[inline(always)]
fn split(a: f64) -> (f64, f64) {
    let c = 134_217_729.0 * a;
    let hi = c - (c - a);
    (hi, a - hi)
}

/// The rounding error of `a * a`, whose rounded value is `p`: exactly `a·a − p`, as `a.mul_add(a, -p)` gives it, for
/// `a` well inside the exponent range (Dekker's product).
#[inline(always)]
fn square_error(a: f64, p: f64) -> f64 {
    let (h, l) = split(a);
    ((h * h - p) + 2.0 * h * l) + l * l
}

/// CORE-MATH's `cr_hypot` (Rust's `libm`, `hypot.rs`) on its fast path, its fused multiply-adds worked out exactly;
/// `None` where it leaves that path, for `f64::hypot` to take over.
#[inline]
fn hypot_fast(x: f64, y: f64) -> Option<f64> {
    const EMSK: u64 = 0x7ff << 52;
    // NaN or infinity.
    if x.to_bits() & EMSK == EMSK || y.to_bits() & EMSK == EMSK {
        return None;
    }
    let (x, y) = (x.abs(), y.abs());
    let (u, v) = if x >= y { (x, y) } else { (y, x) };
    let (xd, yd) = (u.to_bits(), v.to_bits());
    // Along an axis.
    if yd == 0 {
        return Some(u);
    }
    // A subnormal, or sizes so far apart that the smaller hardly counts.
    if yd >> 52 == 0 || xd.wrapping_sub(yd) > (27 << 52) {
        return None;
    }
    // Both scaled so that the larger is in [1, 2).
    let off = (0x3ff_i64 << 52) - (xd & EMSK) as i64;
    let x = f64::from_bits(xd.wrapping_add(off as u64));
    let y = f64::from_bits(yd.wrapping_add(off as u64));
    let x2 = x * x;
    let dx2 = square_error(x, x2);
    let y2 = y * y;
    let dy2 = square_error(y, y2);
    let r2 = x2 + y2;
    let ir2 = 0.5 / r2;
    let dr2 = ((x2 - r2) + y2) + (dx2 + dy2);
    let th = r2.sqrt();
    let rsqrt = th * ir2;
    // th·th − r2 rounded once: th·th is p plus its error exactly, and p − r2 is exact (p is within a factor of two of
    // r2, Sterbenz), so their sum rounds the exact difference once, as the fused multiply-add does.
    let p = th * th;
    let dz = dr2 - ((p - r2) + square_error(th, p));
    let tl = rsqrt * dz;
    // Fast two-sum.
    let s = th + tl;
    let tl = tl - (s - th);
    let thd = s.to_bits();
    let ex = thd & EMSK;
    let aidr = tl.abs().to_bits().wrapping_add(0x3fe << 52).wrapping_sub(ex);
    let mid = (aidr.wrapping_sub(0x3c90_0000_0000_0000).wrapping_add(16)) >> 5;
    if mid == 0 || !(0x39b0_0000_0000_0000..=0x3c9f_ffff_ffff_ff80).contains(&aidr) {
        // Too close to halfway between two doubles to round from here.
        return None;
    }
    let thd = thd.wrapping_sub(off as u64);
    if thd >= EMSK {
        return None;
    }
    Some(f64::from_bits(thd))
}

/// `a·b + c` rounded once, as `f32::mul_add` gives it (native Orca's fused multiply-adds), without its long call into
/// software in WebAssembly: two floats' product is exact in a double, so the sum rounded to a double and then to a
/// float is the fused result, unless the double lands on a halfway point between two floats (its 29 low bits one and
/// then zeros), where the first rounding may have settled the tie the wrong way, or outside the floats' normal range.
/// Those go to `f32::mul_add` itself.
#[inline]
pub fn mul_add32(a: f32, b: f32, c: f32) -> f32 {
    let s = f64::from(a) * f64::from(b) + f64::from(c);
    let size = s.abs();
    if s.to_bits() & 0x1fff_ffff != 0x1000_0000
        && (size >= f64::from(f32::MIN_POSITIVE) || s == 0.0)
        && size <= f64::from(f32::MAX)
    {
        return s as f32;
    }
    a.mul_add(b, c)
}

/// `a·b + c` rounded once, as `f64::mul_add` gives it, without its long call into software in WebAssembly. Dekker's
/// product and two error-free sums write the exact result as a double `r` and two smaller remainders; `r` is the
/// fused result when the remainders together are clearly less than half its last place. What isn't clearly so (a
/// near tie, a power of two, sizes near the ends of the exponent range) goes to `f64::mul_add` itself.
#[inline]
pub fn mul_add64(a: f64, b: f64, c: f64) -> f64 {
    mul_add64_fast(a, b, c).unwrap_or_else(|| a.mul_add(b, c))
}

#[inline(always)]
fn mul_add64_fast(a: f64, b: f64, c: f64) -> Option<f64> {
    let p = a * b;
    let size = p.abs().max(c.abs());
    if !(1e-250..1e250).contains(&size) || (p != 0.0 && p.abs() < 1e-250) {
        return None;
    }
    let (ah, al) = split(a);
    let (bh, bl) = split(b);
    let pe = ((ah * bh - p) + ah * bl + al * bh) + al * bl;
    let (s, se) = two_sum(p, c);
    let (w, we) = two_sum(se, pe);
    let (r, re) = two_sum(s, w);
    let bits = r.to_bits();
    let exponent = (bits >> 52) & 0x7ff;
    if exponent <= 54 || exponent == 0x7ff || bits & 0x000f_ffff_ffff_ffff == 0 {
        return None;
    }
    (re.abs() + we.abs() < f64::from_bits((exponent - 53) << 52)).then_some(r)
}

/// `a + b` rounded, and its rounding error, exactly (Knuth's two-sum).
#[inline(always)]
fn two_sum(a: f64, b: f64) -> (f64, f64) {
    let s = a + b;
    let bb = s - a;
    (s, (a - (s - bb)) + (b - bb))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fixed sequence of positive doubles of mantissas at random, their exponents spread over `range` (xorshift).
    fn doubles(n: usize, mut seed: u64, range: i32) -> Vec<f64> {
        (0..n)
            .map(|_| {
                seed ^= seed << 13;
                seed ^= seed >> 7;
                seed ^= seed << 17;
                let mantissa = (seed >> 12) as f64 / (1u64 << 52) as f64;
                (1.0 + mantissa) * 2f64.powi((seed % range as u64) as i32 - range / 2)
            })
            .collect()
    }

    /// A positive normal double as its 53-bit integer mantissa and the power of two it is scaled by.
    fn parts(d: f64) -> (u128, i32) {
        let b = d.to_bits();
        (u128::from(b & ((1 << 52) - 1) | 1 << 52), (b >> 52) as i32 - 1075)
    }

    /// Whether `h` is √(x² + y²) correctly rounded (to nearest, ties to even), by exact integer arithmetic: for
    /// positive normal doubles no more than 2⁸ apart, where every number here fits in 128 bits.
    fn correctly_rounded(x: f64, y: f64, h: f64) -> bool {
        let ((mu, eu), (mv, ev)) = (parts(x.max(y)), parts(x.min(y)));
        // x² + y² = s · 2^(2·ev).
        let s = ((mu * mu) << (2 * (eu - ev))) + mv * mv;
        let (mh, eh) = parts(h);
        // The midpoints with h's neighbours, in units of 2^(eh − 2) (the one below closer at a power of two).
        let low = if mh == 1 << 52 { 4 * mh - 1 } else { 4 * mh - 2 };
        let high = 4 * mh + 2;
        // Each midpoint m against √(x² + y²): s · 2^(2·ev) against m² · 2^(2·eh − 4).
        let t = 2 * (eh - ev) - 4;
        let cmp = |m: u128| if t >= 0 { s.cmp(&((m * m) << t)) } else { (s << -t).cmp(&(m * m)) };
        let even = mh % 2 == 0;
        let above_low = match cmp(low) {
            std::cmp::Ordering::Greater => true,
            std::cmp::Ordering::Equal => even,
            std::cmp::Ordering::Less => false,
        };
        let below_high = match cmp(high) {
            std::cmp::Ordering::Less => true,
            std::cmp::Ordering::Equal => even,
            std::cmp::Ordering::Greater => false,
        };
        above_low && below_high
    }

    #[test]
    fn the_fast_path_rounds_correctly_as_hypot_does_in_webassembly() {
        // glibc's `hypot` is now and then a unit in the last place off (as for these two), so the fast path is held
        // to √(x² + y²) correctly rounded, which is what Rust's `hypot` gives in WebAssembly (CORE-MATH's).
        let (x, y) = (4.6977823272256376e2, 5.647994514654128e-6);
        assert_eq!(hypot_fast(x, y).map(f64::to_bits), Some(4_646_972_042_261_283_179));
        let (xs, ys) = (doubles(300_000, 0x9e37_79b9_7f4a_7c15, 1000), doubles(300_000, 0xdead_beef_cafe_f00d, 16));
        let mut fast = 0;
        for (&x, &y) in xs.iter().zip(&ys) {
            // Lengths of nearly every size, the second no more than 2⁸ smaller or larger than the first.
            let y = y * x;
            for (a, b) in [(x, y), (x, x), (x.round().max(1.0), y.round().max(1.0)), (x * 3.0, x * 4.0)] {
                if let Some(h) = hypot_fast(a, b) {
                    fast += 1;
                    assert!(correctly_rounded(a, b, h), "hypot({a:e}, {b:e}) = {h:e}");
                }
                assert_eq!(hypot_fast(-a, b), hypot_fast(a, b));
            }
        }
        // Nearly every pair takes the fast path: all but those whose length is exact (3, 4 and 5), which CORE-MATH
        // works out on its slow path too.
        assert!(fast > 1_100_000, "{fast}");
        // What it leaves to `hypot`: special values, subnormals, sizes far apart; along an axis, the other's size.
        for (a, b) in [(f64::NAN, 1.0), (f64::INFINITY, f64::NAN), (1e300, 1e-300), (5e-324, 1.0)] {
            assert_eq!(hypot_fast(a, b), None, "hypot({a:e}, {b:e})");
        }
        assert_eq!(hypot_fast(-2.5, 0.0), Some(2.5));
        assert_eq!(hypot_fast(0.0, 3.0), Some(3.0));
        assert_eq!(hypot_fast(0.0, -0.0).map(f64::to_bits), Some(0));
        assert_eq!(3.0f64.hyp(4.0), 5.0);
    }

    /// The quick fused multiply-add gives what `f32::mul_add` gives: on random floats of every size, on sums that
    /// cancel, and on the halfway points it hands over.
    #[test]
    fn mul_add32_is_f32_mul_add() {
        let mut x = 0x9e37_79b9_7f4a_7c15u64;
        let mut next = || {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            x
        };
        for _ in 0..2_000_000 {
            let r = next();
            let a = f32::from_bits((r as u32 & 0x807f_ffff) | (0x3c00_0000 + ((r >> 32) as u32 % 0x0800_0000)));
            let b = f32::from_bits(next() as u32 & 0xbfff_ffff) % 1e6;
            let c = if r >> 60 == 0 { -(a * b) } else { f32::from_bits(next() as u32 & 0xbfff_ffff) % 1e6 };
            assert_eq!(mul_add32(a, b, c).to_bits(), a.mul_add(b, c).to_bits(), "{a:e} {b:e} {c:e}");
        }
        // (1 + 2⁻²³)² − 2⁻²³ − 2⁻²⁴ is 1 + 2⁻²⁴ + 2⁻⁴⁶, just past halfway between two floats: fused, it rounds up,
        // where the product rounded first would leave it on the halfway point, and round it down to even.
        let (a, b, c) = (1.0 + f32::EPSILON, 1.0 + f32::EPSILON, -f32::EPSILON - f32::EPSILON / 2.0);
        assert_eq!(mul_add32(a, b, c), 1.0 + f32::EPSILON);
        assert_eq!(a * b + c, 1.0);
        assert_eq!(mul_add32(f32::MAX, 2.0, 0.0), f32::INFINITY);
    }

    /// The quick fused multiply-add gives what `f64::mul_add` gives, on products and sums of every size and on sums
    /// that cancel, the Möller–Trumbore dot products' kinds among them.
    #[test]
    fn mul_add64_is_f64_mul_add() {
        let mut x = 0x2545_f491_4f6c_dd1du64;
        let mut next = || {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            x
        };
        let mut fast = 0;
        for k in 0..2_000_000 {
            let r = next();
            let a =
                f64::from(f32::from_bits((r as u32 & 0x807f_ffff) | (0x3c00_0000 + ((r >> 32) as u32 % 0x0800_0000))));
            let b = f64::from_bits(next() & 0xbfff_ffff_ffff_ffff) % 1e6;
            let c = match k % 4 {
                0 => -(a * b),
                1 => -(a * b) * (1.0 + f64::EPSILON * (next() % 64) as f64),
                _ => f64::from_bits(next() & 0xbfff_ffff_ffff_ffff) % 1e6,
            };
            assert_eq!(mul_add64(a, b, c).to_bits(), a.mul_add(b, c).to_bits(), "{a:e} {b:e} {c:e}");
            if let Some(m) = mul_add64_fast(a, b, c) {
                assert_eq!(m.to_bits(), a.mul_add(b, c).to_bits(), "{a:e} {b:e} {c:e}");
                fast += 1;
            }
        }
        // Nearly all take the fast path: all but exact cancellations (a power of two left, or nothing).
        assert!(fast > 1_400_000, "{fast}");
        assert_eq!(mul_add64(1.0 + f64::EPSILON, 1.0 - f64::EPSILON, -1.0), -f64::EPSILON * f64::EPSILON);
    }
}
