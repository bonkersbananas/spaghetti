import { describe, expect, it } from "vitest";
import { bestPhoto, pickCover } from "../../src/shared/cover.ts";

const photo = (id: string, attemptId: string | null, createdAt: number) => ({
  id,
  attemptId,
  createdAt,
  itemId: "i",
  position: 0,
  width: 1,
  height: 1,
  color: "#000000",
  takenAt: null,
});

const file = (id: string, createdAt: number, hasThumb = true) => ({ id, createdAt, hasThumb });

describe("bestPhoto", () => {
  const tries = [
    { id: "a1", outcome: "failed" },
    { id: "a2", outcome: "success" },
    { id: "a3", outcome: "failed" },
  ];

  it("leads with the final photo, then the build's own, then the latest attempt that worked", () => {
    const photos = [photo("p1", "a1", 1), photo("p2", "a2", 2), photo("p3", "a3", 3)];
    expect(bestPhoto(photos, tries, "p3")?.id).toBe("p3");
    expect(bestPhoto([...photos, photo("own", null, 0)], tries, null)?.id).toBe("own");
    expect(bestPhoto(photos, tries, null)?.id).toBe("p2");
  });

  it("falls back to the newest attempt photo when the one that worked has none", () => {
    expect(bestPhoto([photo("p1", "a1", 1), photo("p3", "a3", 3)], tries, null)?.id).toBe("p3");
  });

  it("is an idea's first photo", () => {
    expect(bestPhoto([photo("first", null, 2), photo("second", null, 1)], [], null)?.id).toBe("first");
  });
});

const thumb = (candidate: { hasThumb: boolean }) => candidate.hasThumb;

describe("pickCover", () => {
  const base = {
    photos: [] as ReturnType<typeof photo>[],
    attempts: [] as { id: string; outcome: string | null; file: ReturnType<typeof file> | null }[],
    files: [] as ReturnType<typeof file>[],
    coverPhotoId: null,
    title: "Towel hook",
    note: "",
  };

  it("shows a photo before any plate picture", () => {
    const cover = pickCover({ ...base, photos: [photo("p", null, 1)], files: [file("f", 2)] }, thumb);
    expect(cover).toMatchObject({ kind: "photo", photo: { id: "p" } });
  });

  it("shows the newest plate picture of the build's own files and its attempts'", () => {
    const attempts = [{ id: "a", outcome: null, file: file("attempt-file", 5) }];
    const cover = pickCover({ ...base, attempts, files: [file("old", 1), file("no-thumb", 9, false)] }, thumb);
    expect(cover).toMatchObject({ kind: "plate", file: { id: "attempt-file" } });
  });

  it("puts the file on the bed first", () => {
    const cover = pickCover({ ...base, files: [file("newer", 9)] }, thumb, file("on-the-bed", 1));
    expect(cover).toMatchObject({ kind: "plate", file: { id: "on-the-bed" } });
  });

  it("is the note card without a picture, the title standing in for a missing note", () => {
    expect(pickCover({ ...base, note: "For the bathroom door." }, thumb)).toEqual({
      kind: "note",
      text: "For the bathroom door.",
      fromTitle: false,
    });
    expect(pickCover(base, thumb)).toEqual({ kind: "note", text: "Towel hook", fromTitle: true });
  });
});
