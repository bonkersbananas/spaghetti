import { expect, test } from "vitest";
import { suggestedProducts } from "../../src/shared/product-picks.ts";
import { PRODUCTS } from "../../src/shared/products.ts";

test("a PETG spool is offered no PLA products", () => {
  const offered = suggestedProducts("PETG", "White");
  expect(offered.every((product) => product.material === "PETG")).toBe(true);
  expect(offered.some((product) => product.material === "PLA")).toBe(false);
});

test("PLA gets only PLA products, the colour asked for first", () => {
  const offered = suggestedProducts("PLA", "white");
  expect(offered.every((product) => product.material === "PLA")).toBe(true);
  expect(offered[0]?.colour?.name).toBe("Jade white");
  expect(offered).toHaveLength(PRODUCTS.filter((product) => product.material === "PLA").length);
});

test("no material yet offers every product", () => {
  expect(suggestedProducts("")).toHaveLength(PRODUCTS.length);
});
