/**
 * Picking a product in the new-spool sheet: which chip is lit, what a chip says and what it fills in. Apart from
 * products.ts (which the slicing defaults read) so the screens that only list spools don't load it.
 */

import { PRODUCTS, type Product, productOf } from "./products.ts";
import { finishLabel, type SpoolLike } from "./spools.ts";

/** Is this spool that product: its fields, and its colour when the product comes in one. */
export function isProduct(
  spool: Pick<SpoolLike, "brand" | "line" | "material" | "finish" | "colorHex">,
  product: Product,
): boolean {
  const match = productOf(spool);
  if (!match || match.brand !== product.brand || match.line !== product.line || match.material !== product.material) {
    return false;
  }
  if (match.finish !== product.finish) return false;
  return !product.colour || (spool.colorHex ?? "").toLowerCase() === product.colour.hex;
}

/** The product a spool is, the colour counted: "PLA Basic · Jade white" before plain "PLA Basic". */
export function pickedProduct(
  spool: Pick<SpoolLike, "brand" | "line" | "material" | "finish" | "colorHex">,
): Product | undefined {
  return PRODUCTS.find((product) => product.colour && isProduct(spool, product)) ?? productOf(spool);
}

/** What a product is called on its chip: "Bambu Lab PLA Silk+", "Polymaker PolyTerra PLA", "SUNLU PLA+ Silk (3 colours)". */
export function productName(product: Product): string {
  const words = [
    product.brand,
    product.line,
    product.material,
    product.finish ? finishLabel(product.finish) : null,
    product.colours === 2 ? "dual colour" : product.colours === 3 ? "tri-colour" : null,
  ];
  const kind = words.filter(Boolean).join(" ");
  return product.colour ? `${kind} · ${product.colour.name}` : kind;
}

/** The spool fields a product fills in. */
export function spoolFieldsOf(product: Product) {
  return {
    ...(product.colour ? { colorName: product.colour.name, colorHex: product.colour.hex, colors: null } : {}),
    material: product.material,
    brand: product.brand,
    line: product.line ?? null,
    finish: product.finish ?? null,
    nozzleTempMin: product.nozzle[0],
    nozzleTempMax: product.nozzle[1],
    ...(product.bed ? { bedTempMin: product.bed[0], bedTempMax: product.bed[1] } : {}),
  };
}

/**
 * The products worth offering for a spool of this material: only its own ("PETG" gets no PLA chips), those sold in
 * the wanted colour first ("white" lifts "Jade white"). With no material yet (a field being typed) every product is
 * offered, with the colour match first. A material no product is made in gets none: the fields below do the work.
 */
export function suggestedProducts(material: string, colour?: string | null): Product[] {
  const wanted = material.trim().toLowerCase();
  const word = colour?.trim().toLowerCase();
  const own = PRODUCTS.filter((product) => !wanted || product.material.toLowerCase() === wanted);
  const matches = (product: Product) => !!word && !!product.colour && product.colour.name.toLowerCase().includes(word);
  return [...own.filter(matches), ...own.filter((product) => !matches(product))];
}
