//! Just enough ZIP for 3MF: reading entries (stored or deflated), and writing an archive whose big entry (the
//! G-code) is deflated in independent chunks on every core, joined into one valid stream (as pigz does).

use md5::{Digest, Md5};
use miniz_oxide::deflate::core::{
    CompressorOxide, TDEFLFlush, TDEFLStatus, compress, create_comp_flags_from_zip_params,
};

/// The most a single entry may inflate to (a 3MF's model can be big; nothing in one is bigger than this).
const MAX_ENTRY: usize = 1 << 30;

pub struct Entry<'a> {
    pub name: String,
    method: u16,
    data: &'a [u8],
    size: usize,
}

impl Entry<'_> {
    /// The entry's bytes, or None when it is damaged or packed in a way this doesn't read.
    pub fn read(&self) -> Option<Vec<u8>> {
        match self.method {
            0 => Some(self.data.to_vec()),
            8 => {
                let limit = if self.size > 0 { self.size.min(MAX_ENTRY) } else { MAX_ENTRY };
                miniz_oxide::inflate::decompress_to_vec_with_limit(self.data, limit).ok()
            }
            _ => None,
        }
    }
}

fn u16_at(b: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_le_bytes(b.get(at..at + 2)?.try_into().ok()?))
}

fn u32_at(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(b.get(at..at + 4)?.try_into().ok()?))
}

/// The archive's entries, from its central directory; None if it isn't a ZIP.
pub fn entries(bytes: &[u8]) -> Option<Vec<Entry<'_>>> {
    if bytes.len() < 22 {
        return None;
    }
    // The end of central directory record is in the last 64 KiB + 22 bytes.
    let from = bytes.len().saturating_sub(22 + 65535);
    let eocd = (from..=bytes.len() - 22).rev().find(|&i| u32_at(bytes, i) == Some(0x0605_4b50))?;
    let count = u16_at(bytes, eocd + 10)? as usize;
    let mut at = u32_at(bytes, eocd + 16)? as usize;
    let mut out = Vec::with_capacity(count);
    for _ in 0..count {
        if u32_at(bytes, at)? != 0x0201_4b50 {
            return None;
        }
        let method = u16_at(bytes, at + 10)?;
        let compressed = u32_at(bytes, at + 20)? as usize;
        let size = u32_at(bytes, at + 24)? as usize;
        let name_len = u16_at(bytes, at + 28)? as usize;
        let extra_len = u16_at(bytes, at + 30)? as usize;
        let comment_len = u16_at(bytes, at + 32)? as usize;
        let local = u32_at(bytes, at + 42)? as usize;
        let name = String::from_utf8_lossy(bytes.get(at + 46..at + 46 + name_len)?).into_owned();
        at += 46 + name_len + extra_len + comment_len;
        if u32_at(bytes, local)? != 0x0403_4b50 {
            return None;
        }
        let start = local + 30 + u16_at(bytes, local + 26)? as usize + u16_at(bytes, local + 28)? as usize;
        let data = bytes.get(start..start.checked_add(compressed)?)?;
        out.push(Entry { name, method, data, size });
    }
    Some(out)
}

/// Raw DEFLATE of `data`. Big inputs are cut into chunks compressed on their own (in parallel where there are
/// threads), each ended on a byte boundary, so they join into one stream; the cost is a little ratio.
pub fn deflate(data: &[u8], level: u8) -> Vec<u8> {
    deflate_pieces(data, level).concat()
}

/// `deflate`'s stream, in the pieces it packed.
fn deflate_pieces(data: &[u8], level: u8) -> Vec<Vec<u8>> {
    if data.len() <= CHUNK {
        return vec![deflate_part(data, level, true)];
    }
    let parts = data.len().div_ceil(CHUNK);
    crate::par::map_range(parts, |i| {
        let slice = &data[i * CHUNK..((i + 1) * CHUNK).min(data.len())];
        deflate_part(slice, level, i + 1 == parts)
    })
}

/// The size of the pieces `deflate` packs on their own.
const CHUNK: usize = 1 << 18;

/// How many pieces `Deflater` gathers before it packs them (together, on every core where there are threads).
const BATCH: usize = 16;

/// What `Deflater` packed: the stream in the pieces it packed (kept apart, so that no buffer grows to hold them all),
/// the size and CRC-32 of what was written, and its MD5 when asked for. `Writer::add_deflated` takes it.
pub struct Deflated {
    pub pieces: Vec<Vec<u8>>,
    pub size: usize,
    pub crc: u32,
    pub md5: Option<[u8; 16]>,
}

impl Deflated {
    /// `data` deflated at `level`, with its MD5: what a `Deflater::with_md5` given all of it makes.
    pub fn of(data: &[u8], level: u8) -> Self {
        let (pieces, (crc, md5)) =
            crate::par::join(|| deflate_pieces(data, level), || (crc32fast::hash(data), Md5::digest(data).into()));
        Deflated { pieces, size: data.len(), crc, md5: Some(md5) }
    }

    /// How many bytes the stream takes.
    pub fn packed_len(&self) -> usize {
        self.pieces.iter().map(Vec::len).sum()
    }
}

/// `deflate` for text written a little at a time (`std::fmt::Write`): the same bytes as `deflate` of all of it, packed
/// piece by piece as the pieces fill, so that the whole text is never held (a big mesh's model is over 100 MB of it,
/// a tall print's G-code 80 MB).
pub struct Deflater {
    level: u8,
    /// What isn't packed yet: always the last piece, which is the one that ends the stream.
    pending: Vec<u8>,
    packed: Vec<Vec<u8>>,
    crc: crc32fast::Hasher,
    md5: Option<Md5>,
    size: usize,
}

impl Deflater {
    pub fn new(level: u8) -> Self {
        Deflater {
            level,
            pending: Vec::with_capacity((BATCH + 1) * CHUNK),
            packed: Vec::new(),
            crc: crc32fast::Hasher::new(),
            md5: None,
            size: 0,
        }
    }

    /// A `Deflater` that also works out the MD5 of what it's given.
    pub fn with_md5(level: u8) -> Self {
        Deflater { md5: Some(Md5::new()), ..Deflater::new(level) }
    }

    pub fn write(&mut self, bytes: &[u8]) {
        self.pending.extend_from_slice(bytes);
        if self.pending.len() > BATCH * CHUNK {
            self.pack_whole_pieces();
        }
    }

    /// Packs every whole piece but the last, which may still be the stream's end.
    fn pack_whole_pieces(&mut self) {
        let n = (self.pending.len().saturating_sub(1)) / CHUNK;
        if n == 0 {
            return;
        }
        let (level, pending, crc, md5) = (self.level, &self.pending, &mut self.crc, &mut self.md5);
        let whole = &pending[..n * CHUNK];
        let (pieces, ()) = crate::par::join(
            || crate::par::map_range(n, |i| deflate_part(&pending[i * CHUNK..(i + 1) * CHUNK], level, false)),
            || {
                crc.update(whole);
                if let Some(md5) = md5 {
                    md5.update(whole);
                }
            },
        );
        self.packed.extend(pieces);
        self.size += n * CHUNK;
        self.pending.drain(..n * CHUNK);
    }

    pub fn finish(mut self) -> Deflated {
        self.pack_whole_pieces();
        self.packed.push(deflate_part(&self.pending, self.level, true));
        self.crc.update(&self.pending);
        let md5 = self.md5.map(|mut md5| {
            md5.update(&self.pending);
            md5.finalize().into()
        });
        Deflated { pieces: self.packed, size: self.size + self.pending.len(), crc: self.crc.finalize(), md5 }
    }
}

impl std::fmt::Write for Deflater {
    fn write_str(&mut self, s: &str) -> std::fmt::Result {
        self.write(s.as_bytes());
        Ok(())
    }
}

fn deflate_part(mut input: &[u8], level: u8, last: bool) -> Vec<u8> {
    let flags = create_comp_flags_from_zip_params(level.into(), 0, 0);
    let mut compressor = CompressorOxide::new(flags);
    let mut out = vec![0u8; (input.len() / 2).max(64)];
    let mut at = 0;
    let flush = if last { TDEFLFlush::Finish } else { TDEFLFlush::Sync };
    loop {
        let (status, used, wrote) = compress(&mut compressor, input, &mut out[at..], flush);
        at += wrote;
        input = &input[used..];
        match status {
            TDEFLStatus::Done => break,
            TDEFLStatus::Okay if input.is_empty() && !last && out.len() - at >= 64 => break,
            TDEFLStatus::Okay => {
                if out.len() - at < 1024 {
                    out.resize(out.len() * 2, 0);
                }
            }
            _ => panic!("deflate failed"),
        }
    }
    out.truncate(at);
    // Kept until the archive is written: without the room the guess at its size left (half the input).
    out.shrink_to_fit();
    out
}

/// Writes a ZIP archive, entry by entry. Times are fixed (1980-01-01), so the same input gives the same bytes.
#[derive(Default)]
pub struct Writer {
    out: Vec<u8>,
    central: Vec<u8>,
    count: u16,
}

impl Writer {
    pub fn with_capacity(bytes: usize) -> Self {
        Writer { out: Vec::with_capacity(bytes), ..Default::default() }
    }

    /// Adds an entry, deflated at `level` (0 stores it as it is).
    pub fn add(&mut self, name: &str, data: &[u8], level: u8) {
        if level == 0 {
            self.add_raw(name, data.len(), crc32fast::hash(data), 0, &[data]);
        } else {
            let packed = deflate(data, level);
            self.add_raw(name, data.len(), crc32fast::hash(data), 8, &[packed]);
        }
    }

    /// Adds an entry already deflated (see `Deflater`).
    pub fn add_deflated(&mut self, name: &str, packed: &Deflated) {
        self.add_raw(name, packed.size, packed.crc, 8, &packed.pieces);
    }

    fn add_raw(&mut self, name: &str, size: usize, crc: u32, method: u16, pieces: &[impl AsRef<[u8]>]) {
        let offset = self.out.len() as u32;
        let packed_len: usize = pieces.iter().map(|p| p.as_ref().len()).sum();
        let header = |v: &mut Vec<u8>, central: bool| {
            v.extend_from_slice(&(if central { 0x0201_4b50u32 } else { 0x0403_4b50 }).to_le_bytes());
            if central {
                v.extend_from_slice(&20u16.to_le_bytes()); // made by
            }
            v.extend_from_slice(&20u16.to_le_bytes()); // needed to extract
            v.extend_from_slice(&0x0800u16.to_le_bytes()); // UTF-8 names
            v.extend_from_slice(&method.to_le_bytes());
            v.extend_from_slice(&0u16.to_le_bytes()); // time
            v.extend_from_slice(&0x0021u16.to_le_bytes()); // 1980-01-01
            v.extend_from_slice(&crc.to_le_bytes());
            v.extend_from_slice(&(packed_len as u32).to_le_bytes());
            v.extend_from_slice(&(size as u32).to_le_bytes());
            v.extend_from_slice(&(name.len() as u16).to_le_bytes());
            v.extend_from_slice(&0u16.to_le_bytes()); // extra
            if central {
                v.extend_from_slice(&0u16.to_le_bytes()); // comment
                v.extend_from_slice(&0u16.to_le_bytes()); // disk
                v.extend_from_slice(&0u16.to_le_bytes()); // internal attributes
                v.extend_from_slice(&0u32.to_le_bytes()); // external attributes
                v.extend_from_slice(&offset.to_le_bytes());
            }
            v.extend_from_slice(name.as_bytes());
        };
        header(&mut self.out, false);
        for piece in pieces {
            self.out.extend_from_slice(piece.as_ref());
        }
        header(&mut self.central, true);
        self.count += 1;
    }

    pub fn finish(mut self) -> Vec<u8> {
        let start = self.out.len() as u32;
        self.out.extend_from_slice(&self.central);
        self.out.extend_from_slice(&0x0605_4b50u32.to_le_bytes());
        self.out.extend_from_slice(&[0, 0, 0, 0]);
        self.out.extend_from_slice(&self.count.to_le_bytes());
        self.out.extend_from_slice(&self.count.to_le_bytes());
        self.out.extend_from_slice(&(self.central.len() as u32).to_le_bytes());
        self.out.extend_from_slice(&start.to_le_bytes());
        self.out.extend_from_slice(&0u16.to_le_bytes());
        self.out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn what_it_writes_it_reads_back() {
        let big: Vec<u8> =
            (0..3_500_000u32).flat_map(|i| format!("G1 X{} Y{}\n", i % 977, i % 13).into_bytes()).collect();
        let mut w = Writer::default();
        w.add("a.txt", b"hello", 6);
        w.add("big.gcode", &big, 6);
        w.add("stored.png", b"\x89PNG", 0);
        let zip = w.finish();
        let entries = entries(&zip).expect("a zip");
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, ["a.txt", "big.gcode", "stored.png"]);
        assert_eq!(entries[0].read().unwrap(), b"hello");
        assert_eq!(entries[1].read().unwrap(), big);
        assert_eq!(entries[2].read().unwrap(), b"\x89PNG");
    }

    #[test]
    fn text_written_a_little_at_a_time_packs_as_it_would_all_at_once() {
        // Around every boundary: nothing, under a piece, a piece exactly, a byte either side, a batch and more.
        let text: Vec<u8> = (0..175_000u32)
            .flat_map(|i| format!("<vertex x=\"{}\" y=\"{}\"/>\n", i % 977, i % 13).into_bytes())
            .collect();
        for len in [0, 1, CHUNK - 1, CHUNK, CHUNK + 1, 3 * CHUNK, BATCH * CHUNK, BATCH * CHUNK + 1, text.len()] {
            let text = &text[..len];
            for step in [1, 7, 4096, 1 << 20] {
                if step == 1 && len > CHUNK + 1 {
                    continue;
                }
                let mut d = Deflater::with_md5(6);
                for piece in text.chunks(step.min(len.max(1))) {
                    d.write(piece);
                }
                let d = d.finish();
                assert_eq!(d.pieces.concat(), deflate(text, 6), "{len} bytes, {step} at a time");
                assert_eq!((d.size, d.crc), (len, crc32fast::hash(text)));
                let whole = Deflated::of(text, 6);
                assert_eq!((whole.pieces.concat(), whole.size, whole.crc), (d.pieces.concat(), d.size, d.crc));
                assert_eq!(whole.md5, d.md5);
                assert_eq!(d.md5, Some(Md5::digest(text).into()));
            }
        }
    }

    #[test]
    fn not_a_zip_is_none() {
        assert!(entries(b"solid cube\nendsolid").is_none());
        assert!(entries(&[0u8; 100]).is_none());
    }
}
