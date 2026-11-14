/**
 * An .stl as a minimal 3MF, streamed (decision 0059): Bambu Studio opens only .3mf by address, so "Open the original
 * model in Bambu Studio" wraps an .stl on the way. Nothing is held whole: the STL is read in pieces, its triangles
 * written as 3MF's XML (three vertices to a triangle, none shared: Bambu Studio merges them on loading) and deflated
 * by the platform's CompressionStream, inside a ZIP whose big entry has its sizes after it (a data descriptor), so the
 * answer starts at once and memory stays flat. Binary and ASCII STL; triangles with a coordinate that isn't a number
 * are left out. Pure Web APIs: runs in the Worker and in tests.
 */

/**
 * The biggest .stl wrapped on the way. Writing its XML costs the Worker CPU time (3 s for 20 MB of random triangles,
 * the worst case, measured in Node), against a 30 s default limit; a bigger one is opened as the file you slice first.
 */
export const STL_WRAP_MAX_BYTES = 32 * 1024 * 1024;

const encoder = new TextEncoder();

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 (zip's), continued from `crc` (start at 0). */
export function crc32(bytes: Uint8Array, crc = 0): number {
  let c = ~crc;
  for (let i = 0; i < bytes.length; i++) c = (CRC_TABLE[(c ^ (bytes[i] as number)) & 0xff] as number) ^ (c >>> 8);
  return ~c >>> 0;
}

/** A float32 as short text that reads back as the same float32. */
const num = (value: number) => String(Number(value.toPrecision(9)));

const MODEL_HEAD =
  '<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n <resources>\n  <object id="1" type="model">\n   <mesh>\n    <vertices>\n';
const MODEL_MID = "    </vertices>\n    <triangles>\n";
const MODEL_TAIL =
  '    </triangles>\n   </mesh>\n  </object>\n </resources>\n <build>\n  <item objectid="1"/>\n </build>\n</model>\n';
const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n</Types>\n';
const RELS =
  '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n</Relationships>\n';

/** Every vertex of an STL, three to a triangle, as `[x,y,z]` runs of text; `count` rises as they are read. */
async function* stlVertices(
  body: ReadableStream<Uint8Array>,
  size: number,
  count: { vertices: number },
): AsyncGenerator<string> {
  const reader = body.getReader();
  const emit = (coords: number[]): string => {
    let out = "";
    for (let t = 0; t + 9 <= coords.length; t += 9) {
      if (!coords.slice(t, t + 9).every(Number.isFinite)) continue;
      for (let v = 0; v < 9; v += 3) {
        out += `     <vertex x="${num(coords[t + v] as number)}" y="${num(coords[t + v + 1] as number)}" z="${num(coords[t + v + 2] as number)}"/>\n`;
      }
      count.vertices += 3;
    }
    return out;
  };
  try {
    let carry = new Uint8Array(0);
    let binary: boolean | null = null;
    let remaining = 0;
    let text = "";
    const decoder = new TextDecoder();
    const pending: number[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      let chunk: Uint8Array = value;
      if (binary === null) {
        // The first 84 bytes say which kind: a binary STL's size is 84 + 50 a triangle.
        const joined = new Uint8Array(carry.length + chunk.length);
        joined.set(carry);
        joined.set(chunk, carry.length);
        if (joined.length < 84 && joined.length < size) {
          carry = joined;
          continue;
        }
        const triangles = joined.length >= 84 ? new DataView(joined.buffer, joined.byteOffset).getUint32(80, true) : 0;
        // Binary when the header's count fits the file: padding after the triangles is allowed (ASCII's bytes 80-83 are text, a count far too big).
        binary = triangles > 0 && size >= 84 + 50 * triangles;
        remaining = triangles;
        carry = new Uint8Array(0);
        chunk = binary ? joined.subarray(84) : joined;
      }
      if (binary) {
        const joined = new Uint8Array(carry.length + chunk.length);
        joined.set(carry);
        joined.set(chunk, carry.length);
        const whole = Math.min(joined.length - (joined.length % 50), remaining * 50);
        remaining -= whole / 50;
        const view = new DataView(joined.buffer, joined.byteOffset, joined.length);
        const coords: number[] = [];
        for (let at = 0; at < whole; at += 50) {
          for (let k = 0; k < 9; k++) coords.push(view.getFloat32(at + 12 + k * 4, true));
        }
        carry = remaining > 0 ? joined.slice(whole) : new Uint8Array(0);
        const out = emit(coords);
        if (out) yield out;
      } else {
        text += decoder.decode(chunk, { stream: true });
        const cut = text.lastIndexOf("\n");
        if (cut < 0) continue;
        const lines = text.slice(0, cut).split("\n");
        text = text.slice(cut + 1);
        for (const line of lines) {
          const match = /^\s*vertex\s+(\S+)\s+(\S+)\s+(\S+)/i.exec(line);
          if (match)
            pending.push(Math.fround(Number(match[1])), Math.fround(Number(match[2])), Math.fround(Number(match[3])));
        }
        const whole = pending.length - (pending.length % 9);
        const out = emit(pending.splice(0, whole));
        if (out) yield out;
      }
    }
    if (binary === false) {
      const match = /^\s*vertex\s+(\S+)\s+(\S+)\s+(\S+)/i.exec(text + decoder.decode());
      if (match)
        pending.push(Math.fround(Number(match[1])), Math.fround(Number(match[2])), Math.fround(Number(match[3])));
      const out = emit(pending.splice(0, pending.length - (pending.length % 9)));
      if (out) yield out;
    }
  } finally {
    reader.releaseLock();
  }
}

/** The model part's XML, in pieces: the vertices as the STL is read, then the triangles that number them in order. */
async function* modelXml(body: ReadableStream<Uint8Array>, size: number): AsyncGenerator<Uint8Array> {
  const count = { vertices: 0 };
  yield encoder.encode(MODEL_HEAD);
  for await (const piece of stlVertices(body, size, count)) yield encoder.encode(piece);
  yield encoder.encode(MODEL_MID);
  const triangles = count.vertices / 3;
  for (let from = 0; from < triangles; from += 20_000) {
    let out = "";
    for (let t = from; t < Math.min(triangles, from + 20_000); t++) {
      out += `     <triangle v1="${3 * t}" v2="${3 * t + 1}" v3="${3 * t + 2}"/>\n`;
    }
    yield encoder.encode(out);
  }
  yield encoder.encode(MODEL_TAIL);
}

const u16 = (n: number) => [n & 0xff, (n >>> 8) & 0xff];
const u32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
// 2024-01-01 00:00, in DOS's date and time words (a 3MF doesn't care; zip wants some).
const DOS_TIME = 0;
const DOS_DATE = ((2024 - 1980) << 9) | (1 << 5) | 1;

interface Entry {
  name: string;
  method: 0 | 8;
  crc: number;
  compressed: number;
  size: number;
  offset: number;
  streamed: boolean;
}

const header = (e: Pick<Entry, "name" | "method" | "streamed"> & Partial<Entry>) => {
  const name = encoder.encode(e.name);
  return new Uint8Array([
    ...u32(0x04034b50),
    ...u16(20),
    ...u16(e.streamed ? 0x0808 : 0x0800),
    ...u16(e.method),
    ...u16(DOS_TIME),
    ...u16(DOS_DATE),
    ...u32(e.streamed ? 0 : (e.crc ?? 0)),
    ...u32(e.streamed ? 0 : (e.compressed ?? 0)),
    ...u32(e.streamed ? 0 : (e.size ?? 0)),
    ...u16(name.length),
    ...u16(0),
    ...name,
  ]);
};

/**
 * The 3MF of an .stl kept in `body` (`size` bytes), as a stream of its bytes. Opens the model part last, so the two
 * small parts lead it. Errors in the STL's read end the stream with an error.
 */
export function stlTo3mf(body: ReadableStream<Uint8Array>, size: number): ReadableStream<Uint8Array> {
  const entries: Entry[] = [];
  let offset = 0;
  async function* bytes(): AsyncGenerator<Uint8Array> {
    const put = (chunk: Uint8Array) => {
      offset += chunk.length;
      return chunk;
    };
    for (const [name, text] of [
      ["[Content_Types].xml", CONTENT_TYPES],
      ["_rels/.rels", RELS],
    ] as const) {
      const data = encoder.encode(text);
      const entry: Entry = {
        name,
        method: 0,
        crc: crc32(data),
        compressed: data.length,
        size: data.length,
        offset,
        streamed: false,
      };
      entries.push(entry);
      yield put(header(entry));
      yield put(data);
    }
    const model: Entry = {
      name: "3D/3dmodel.model",
      method: 8,
      crc: 0,
      compressed: 0,
      size: 0,
      offset,
      streamed: true,
    };
    entries.push(model);
    yield put(header(model));
    const deflate = new CompressionStream("deflate-raw");
    const writer = deflate.writable.getWriter();
    const pump = (async () => {
      try {
        for await (const piece of modelXml(body, size)) {
          model.crc = crc32(piece, model.crc);
          model.size += piece.length;
          await writer.write(piece as Uint8Array<ArrayBuffer>);
        }
        await writer.close();
      } catch (error) {
        await writer.abort(error).catch(() => {});
        throw error;
      }
    })();
    pump.catch(() => {});
    const reader = deflate.readable.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      model.compressed += value.length;
      yield put(value);
    }
    await pump;
    // The data descriptor, then the directory.
    yield put(new Uint8Array([...u32(0x08074b50), ...u32(model.crc), ...u32(model.compressed), ...u32(model.size)]));
    const start = offset;
    for (const e of entries) {
      const name = encoder.encode(e.name);
      yield put(
        new Uint8Array([
          ...u32(0x02014b50),
          ...u16(20),
          ...u16(20),
          ...u16(e.streamed ? 0x0808 : 0x0800),
          ...u16(e.method),
          ...u16(DOS_TIME),
          ...u16(DOS_DATE),
          ...u32(e.crc),
          ...u32(e.compressed),
          ...u32(e.size),
          ...u16(name.length),
          ...u16(0),
          ...u16(0),
          ...u16(0),
          ...u16(0),
          ...u32(0),
          ...u32(e.offset),
          ...name,
        ]),
      );
    }
    const length = offset - start;
    yield put(
      new Uint8Array([
        ...u32(0x06054b50),
        ...u16(0),
        ...u16(0),
        ...u16(entries.length),
        ...u16(entries.length),
        ...u32(length),
        ...u32(start),
        ...u16(0),
      ]),
    );
  }
  const iterator = bytes();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await iterator.next();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    async cancel() {
      await iterator.return(undefined);
    },
  });
}
