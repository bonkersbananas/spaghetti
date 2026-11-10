/**
 * Image work for pnpm screenshots:compare, done in the browser that is
 * already there for the screenshots (canvas), so it needs no image library.
 * `installImageTools` runs inside a page (page.evaluate) and puts the tools
 * on `window.imageTools`; it must stay self-contained, because it is
 * serialized into the page.
 */

export type TileStatus = "same" | "changed" | "new" | "removed" | "failed";

export interface Tile {
  label: string;
  status: TileStatus;
  /** Percent of pixels that changed, for "changed". */
  percent?: number;
  /** The image to show (the "after", or the "before" for a removed screen). */
  url?: string;
}

export interface Encoded {
  /** Base64 of the image bytes. */
  data: string;
  ext: "png" | "jpg";
}

export interface DiffResult {
  changed: boolean;
  changedPixels: number;
  /** Share of the picture that changed, in percent. */
  percent: number;
  sizeChanged: boolean;
  baseSize: [number, number];
  headSize: [number, number];
  /** The diff picture on its own, only when something changed. */
  diff?: Encoded;
  /** Before, after and diff together, cropped to what changed. */
  panel?: Encoded & { cropped: boolean };
}

export interface ImageTools {
  compare(options: {
    baseUrl: string;
    headUrl: string;
    baseLabel: string;
    headLabel: string;
    /** Stack the three pictures instead of putting them side by side (wide screens). */
    stacked: boolean;
    /** Most rows of a picture to show in the panel. */
    maxRows: number;
  }): Promise<DiffResult>;
  sheet(options: {
    title: string;
    tiles: Tile[];
    tileWidth: number;
    columns: number;
    maxTileHeight: number;
  }): Promise<Encoded>;
}

declare global {
  interface Window {
    imageTools: ImageTools;
  }
}

export function installImageTools() {
  const PAPER = "#f4efe8";
  const INK = "#2b2622";
  const FAINT = "#7d746b";
  const TOMATO = "#c8452d";
  const BASIL = "#3f7a4a";
  const MAX_BYTES = 4_500_000;
  /** A channel difference below this is anti-aliasing noise, not a change. */
  const THRESHOLD = 12;
  const CELL = 24;
  const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";

  async function load(url: string): Promise<HTMLImageElement> {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  }

  function canvasOf(width: number, height: number) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("No 2d canvas");
    return { canvas, context };
  }

  /** PNG, or JPEG when the PNG is too large to publish (5 MB). */
  async function encode(canvas: HTMLCanvasElement): Promise<{ data: string; ext: "png" | "jpg" }> {
    const toBlob = (type: string, quality?: number) =>
      new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Encoding failed"))), type, quality),
      );
    let blob = await toBlob("image/png");
    let ext: "png" | "jpg" = "png";
    if (blob.size > MAX_BYTES) {
      blob = await toBlob("image/jpeg", 0.85);
      ext = "jpg";
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    return { data: btoa(binary), ext };
  }

  function header(context: CanvasRenderingContext2D, text: string, x: number, y: number, color = INK) {
    context.fillStyle = color;
    context.font = `600 15px ${FONT}`;
    context.textBaseline = "middle";
    context.fillText(text, x, y);
  }

  async function compare(options: {
    baseUrl: string;
    headUrl: string;
    baseLabel: string;
    headLabel: string;
    stacked: boolean;
    maxRows: number;
  }) {
    const [base, head] = await Promise.all([load(options.baseUrl), load(options.headUrl)]);
    const width = Math.max(base.width, head.width);
    const height = Math.max(base.height, head.height);
    const a = canvasOf(width, height);
    const b = canvasOf(width, height);
    a.context.drawImage(base, 0, 0);
    b.context.drawImage(head, 0, 0);
    const pixelsA = a.context.getImageData(0, 0, width, height).data;
    const pixelsB = b.context.getImageData(0, 0, width, height).data;

    const diff = canvasOf(width, height);
    const out = diff.context.createImageData(width, height);
    const cells = new Set<number>();
    const cellsAcross = Math.ceil(width / CELL);
    let changedPixels = 0;
    let top = height;
    let bottom = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const index = (y * width + x) * 4;
        const inBoth = x < base.width && y < base.height && x < head.width && y < head.height;
        const changed =
          !inBoth ||
          Math.abs((pixelsA[index] ?? 0) - (pixelsB[index] ?? 0)) > THRESHOLD ||
          Math.abs((pixelsA[index + 1] ?? 0) - (pixelsB[index + 1] ?? 0)) > THRESHOLD ||
          Math.abs((pixelsA[index + 2] ?? 0) - (pixelsB[index + 2] ?? 0)) > THRESHOLD;
        if (changed) {
          changedPixels++;
          if (y < top) top = y;
          if (y > bottom) bottom = y;
          cells.add(Math.floor(y / CELL) * cellsAcross + Math.floor(x / CELL));
          out.data[index] = 214;
          out.data[index + 1] = 28;
          out.data[index + 2] = 110;
          out.data[index + 3] = 255;
        } else {
          // Unchanged: the "after", faded to a grey ghost so the changes stand out.
          const grey =
            ((pixelsB[index] ?? 0) * 0.3 + (pixelsB[index + 1] ?? 0) * 0.59 + (pixelsB[index + 2] ?? 0) * 0.11) * 0.35 +
            165;
          out.data[index] = grey;
          out.data[index + 1] = grey;
          out.data[index + 2] = grey;
          out.data[index + 3] = 255;
        }
      }
    }
    const result: DiffResult = {
      changed: changedPixels > 0,
      changedPixels,
      percent: (changedPixels / (width * height)) * 100,
      sizeChanged: base.width !== head.width || base.height !== head.height,
      baseSize: [base.width, base.height],
      headSize: [head.width, head.height],
    };
    if (!result.changed) return result;

    // Rings around every patch that changed, so a single moved pixel is findable.
    diff.context.putImageData(out, 0, 0);
    diff.context.fillStyle = "rgba(214, 28, 110, 0.14)";
    diff.context.strokeStyle = "rgba(214, 28, 110, 0.85)";
    diff.context.lineWidth = 2;
    for (const cell of cells) {
      const x = (cell % cellsAcross) * CELL;
      const y = Math.floor(cell / cellsAcross) * CELL;
      diff.context.fillRect(x, y, CELL, CELL);
      diff.context.strokeRect(x + 1, y + 1, CELL - 2, CELL - 2);
    }
    result.diff = await encode(diff.canvas);

    // The panel shows just the rows that changed, with some room around them.
    const pad = 80;
    const y0 = Math.max(0, top - pad);
    const rows = Math.min(height - y0, Math.max(bottom + pad - y0, 1), options.maxRows);
    const cropped = bottom + pad - y0 > options.maxRows;
    const gap = 16;
    const bar = 36;
    const columns = options.stacked ? 1 : 3;
    const lines = options.stacked ? 3 : 1;
    const panel = canvasOf(width * columns + gap * (columns + 1), (rows + bar) * lines + gap * (lines + 1));
    panel.context.fillStyle = PAPER;
    panel.context.fillRect(0, 0, panel.canvas.width, panel.canvas.height);
    const parts: Array<[string, HTMLCanvasElement, string]> = [
      [options.baseLabel, a.canvas, INK],
      [options.headLabel, b.canvas, INK],
      [
        `Diff: ${result.percent.toFixed(2)}% changed${result.sizeChanged ? `, size ${base.width}×${base.height} → ${head.width}×${head.height}` : ""}${cropped ? ", cropped" : ""}`,
        diff.canvas,
        TOMATO,
      ],
    ];
    parts.forEach(([label, source, color], index) => {
      const x = gap + (options.stacked ? 0 : index * (width + gap));
      const y = gap + (options.stacked ? index * (rows + bar + gap) : 0);
      header(panel.context, label, x, y + bar / 2, color);
      panel.context.drawImage(source, 0, y0, width, rows, x, y + bar, width, rows);
    });
    result.panel = { ...(await encode(panel.canvas)), cropped };
    return result;
  }

  async function sheet(options: {
    title: string;
    tiles: Tile[];
    tileWidth: number;
    columns: number;
    maxTileHeight: number;
  }) {
    const { tiles, tileWidth, columns, maxTileHeight } = options;
    const gap = 20;
    const label = 44;
    const titleBar = 64;
    const images = await Promise.all(tiles.map((tile) => (tile.url ? load(tile.url) : undefined)));
    const heights = images.map((image) =>
      image
        ? Math.min(Math.round((image.height / image.width) * tileWidth), maxTileHeight)
        : Math.round(maxTileHeight / 2),
    );
    const rows = Math.ceil(tiles.length / columns);
    const rowHeights = Array.from(
      { length: rows },
      (_, row) => Math.max(...heights.slice(row * columns, row * columns + columns)) + label,
    );
    const width = columns * tileWidth + (columns + 1) * gap;
    const height = titleBar + rowHeights.reduce((sum, value) => sum + value + gap, 0) + gap;
    const { canvas, context } = canvasOf(width, height);
    context.fillStyle = PAPER;
    context.fillRect(0, 0, width, height);
    context.fillStyle = INK;
    context.font = `700 22px ${FONT}`;
    context.textBaseline = "middle";
    context.fillText(options.title, gap, titleBar / 2 + 4);

    let y = titleBar + gap;
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const index = row * columns + column;
        const tile = tiles[index];
        if (!tile) continue;
        const x = gap + column * (tileWidth + gap);
        const image = images[index];
        const tileHeight = heights[index] ?? 0;
        if (image) {
          const sourceHeight = Math.min(image.height, Math.round((tileHeight / tileWidth) * image.width));
          context.drawImage(image, 0, 0, image.width, sourceHeight, x, y, tileWidth, tileHeight);
          if (sourceHeight < image.height) {
            // The picture goes on below the tile: fade its bottom edge.
            const fade = context.createLinearGradient(0, y + tileHeight - 36, 0, y + tileHeight);
            fade.addColorStop(0, "rgba(244, 239, 232, 0)");
            fade.addColorStop(1, PAPER);
            context.fillStyle = fade;
            context.fillRect(x, y + tileHeight - 36, tileWidth, 36);
          }
        } else {
          context.fillStyle = "rgba(125, 116, 107, 0.15)";
          context.fillRect(x, y, tileWidth, tileHeight);
          context.fillStyle = FAINT;
          context.font = `600 16px ${FONT}`;
          context.textAlign = "center";
          context.fillText("no screenshot", x + tileWidth / 2, y + tileHeight / 2);
          context.textAlign = "left";
        }
        const color =
          tile.status === "changed" || tile.status === "failed" || tile.status === "removed"
            ? TOMATO
            : tile.status === "new"
              ? BASIL
              : FAINT;
        if (tile.status !== "same") {
          context.strokeStyle = color;
          context.lineWidth = 4;
          context.strokeRect(x - 2, y - 2, tileWidth + 4, tileHeight + 4);
        }
        context.fillStyle = INK;
        context.font = `600 15px ${FONT}`;
        context.fillText(tile.label, x, y + tileHeight + 18);
        const note =
          tile.status === "changed"
            ? `changed, ${(tile.percent ?? 0).toFixed(tile.percent && tile.percent < 1 ? 2 : 1)}%`
            : tile.status === "same"
              ? ""
              : tile.status;
        if (note) {
          context.fillStyle = color;
          context.font = `600 13px ${FONT}`;
          context.fillText(note, x, y + tileHeight + 36);
        }
      }
      y += (rowHeights[row] ?? 0) + gap;
    }
    return encode(canvas);
  }

  window.imageTools = { compare, sheet };
}
