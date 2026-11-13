//! Just enough ZIP for 3MF: reading entries (stored or deflated), and writing an archive whose big entry (the
//! G-code) is deflated in independent chunks on every core, joined into one valid stream (as pigz does).

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
    const CHUNK: usize = 1 << 18;
    if data.len() <= CHUNK {
        return deflate_part(data, level, true);
    }
    let parts = data.len().div_ceil(CHUNK);
    let pieces = crate::par::map_range(parts, |i| {
        let slice = &data[i * CHUNK..((i + 1) * CHUNK).min(data.len())];
        deflate_part(slice, level, i + 1 == parts)
    });
    pieces.concat()
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
            self.add_raw(name, data.len(), crc32fast::hash(data), 0, data);
        } else {
            let packed = deflate(data, level);
            self.add_raw(name, data.len(), crc32fast::hash(data), 8, &packed);
        }
    }

    /// Adds an entry already deflated (see `deflate`), given its size and CRC-32.
    pub fn add_deflated(&mut self, name: &str, size: usize, crc: u32, packed: &[u8]) {
        self.add_raw(name, size, crc, 8, packed);
    }

    fn add_raw(&mut self, name: &str, size: usize, crc: u32, method: u16, packed: &[u8]) {
        let offset = self.out.len() as u32;
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
            v.extend_from_slice(&(packed.len() as u32).to_le_bytes());
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
        self.out.extend_from_slice(packed);
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
    fn not_a_zip_is_none() {
        assert!(entries(b"solid cube\nendsolid").is_none());
        assert!(entries(&[0u8; 100]).is_none());
    }
}
