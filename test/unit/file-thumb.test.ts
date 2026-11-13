import { describe, expect, it } from "vitest";
import { fileThumbUrl } from "../../src/shared/api.ts";

describe("a file's plate picture", () => {
  it("is at an address of its slice, so a re-slice or its undo elsewhere shows the new picture", () => {
    const id = "6f1c2d3e-0000-4000-8000-000000000001";
    expect(fileThumbUrl({ id })).toBe(`/api/files/${id}/thumb`);
    expect(fileThumbUrl({ id, slice: null })).toBe(`/api/files/${id}/thumb`);
    expect(fileThumbUrl({ id, slice: { at: 1_731_500_000_000 } })).toBe(`/api/files/${id}/thumb?v=1731500000000`);
    expect(fileThumbUrl({ id, slice: { at: 1_731_500_000_001 } })).not.toBe(
      fileThumbUrl({ id, slice: { at: 1_731_500_000_000 } }),
    );
  });
});
