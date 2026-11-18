/**
 * The filaments Spaghetti knows by name: what a maker's product page says it is (brand, line, material, finish,
 * how many colours) and its printing range. Tapping one in the new-spool sheet fills those in, and a spool added
 * from the label keeps the maker's range, so a slice stays inside it. Data from the makers' own pages; pure.
 */
import { brandLabel, finishLabel, type SpoolLike } from "./spools.ts";

export interface Product {
  /** Stable key. */
  id: string;
  brand: string;
  /** The product line said before the material: "PolyTerra". */
  line?: string;
  material: string;
  finish?: string;
  /** How many colours one spool carries: 1 (the default), or 2 and 3 for the co-extruded silks. */
  colours?: 2 | 3;
  /** The colour of a product that is sold in one ("Jade white"); otherwise the colour is picked. */
  colour?: { name: string; hex: string };
  /** The maker's printing range in °C. */
  nozzle: readonly [number, number];
  /** The maker's bed range in °C. */
  bed?: readonly [number, number];
}

export const PRODUCTS: readonly Product[] = [
  { id: "bambu-basic", brand: "Bambu Lab", material: "PLA", finish: "basic", nozzle: [190, 230], bed: [35, 45] },
  {
    id: "bambu-basic-jade-white",
    brand: "Bambu Lab",
    material: "PLA",
    finish: "basic",
    colour: { name: "Jade white", hex: "#f4f1ea" },
    nozzle: [190, 230],
    bed: [35, 45],
  },
  {
    id: "bambu-basic-black",
    brand: "Bambu Lab",
    material: "PLA",
    finish: "basic",
    colour: { name: "Black", hex: "#1d1d1f" },
    nozzle: [190, 230],
    bed: [35, 45],
  },
  { id: "bambu-matte", brand: "Bambu Lab", material: "PLA", finish: "matte", nozzle: [190, 230], bed: [35, 45] },
  { id: "bambu-silk-plus", brand: "Bambu Lab", material: "PLA", finish: "silk+", nozzle: [210, 240], bed: [35, 45] },
  { id: "bambu-pure", brand: "Bambu Lab", material: "PLA", finish: "pure", nozzle: [190, 230], bed: [35, 45] },
  { id: "elegoo-pla", brand: "Elegoo", material: "PLA", nozzle: [190, 230], bed: [35, 65] },
  { id: "elegoo-basic", brand: "Elegoo", material: "PLA", finish: "basic", nozzle: [190, 230], bed: [35, 65] },
  { id: "polyterra", brand: "Polymaker", line: "PolyTerra", material: "PLA", nozzle: [190, 230], bed: [25, 60] },
  {
    id: "panchroma-matte",
    brand: "Polymaker",
    line: "Panchroma",
    material: "PLA",
    finish: "matte",
    nozzle: [190, 230],
    bed: [25, 60],
  },
  { id: "3djake-ecopla", brand: "3DJAKE", line: "ecoPLA", material: "PLA", nozzle: [195, 215], bed: [0, 60] },
  {
    id: "anycubic-silk-dual",
    brand: "Anycubic",
    material: "PLA",
    finish: "silk",
    colours: 2,
    nozzle: [210, 240],
    bed: [55, 65],
  },
  {
    id: "sunlu-silk-tri",
    brand: "SUNLU",
    material: "PLA+",
    finish: "silk",
    colours: 3,
    nozzle: [205, 235],
    bed: [50, 60],
  },
];

const same = (a: string | null | undefined, b: string | undefined) =>
  (a ?? "").trim().toLowerCase() === (b ?? "").toLowerCase();

/** The product a spool is: the same brand (as makers spell it), line, material and finish; the colour doesn't matter. */
export function productOf(spool: Pick<SpoolLike, "brand" | "line" | "material" | "finish">): Product | undefined {
  const brand = brandLabel(spool.brand);
  return PRODUCTS.find(
    (product) =>
      same(brand, product.brand) &&
      same(spool.line, product.line) &&
      same(spool.material, product.material) &&
      same(spool.finish, product.finish),
  );
}
