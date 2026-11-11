import { describe, expect, it } from "vitest";
import {
  type Comment,
  commentPushText,
  GROUP_GAP_MS,
  groupThread,
  isUnread,
  PUSH_BATCH_MS,
  splitTrailingLink,
  threadUrl,
  unreadLine,
} from "../../src/shared/comments.ts";

const MIN = 60_000;
let n = 0;
const c = (authorId: string, at: number, extra: Partial<Comment> = {}): Comment => ({
  id: `c${++n}`,
  itemId: "item",
  authorId,
  via: null,
  body: "hi",
  createdAt: at,
  editedAt: null,
  ...extra,
});

describe("groupThread", () => {
  it("keeps one person's consecutive messages together and splits on the other person", () => {
    const entries = groupThread([c("a", 0), c("a", MIN), c("b", 2 * MIN), c("a", 3 * MIN)], {
      me: "a",
      dividerAt: 10 * MIN,
    });
    expect(entries.map((e) => (e.kind === "group" ? `${e.authorId}${e.comments.length}` : "new"))).toEqual([
      "a2",
      "b1",
      "a1",
    ]);
  });

  it("splits a group after a long pause, and by agent", () => {
    const entries = groupThread(
      [c("a", 0), c("a", GROUP_GAP_MS), c("a", GROUP_GAP_MS * 2 + 1), c("a", GROUP_GAP_MS * 2 + 2, { via: "agent" })],
      { me: "a", dividerAt: null },
    );
    expect(entries.map((e) => (e.kind === "group" ? e.comments.length : 0))).toEqual([2, 1, 1]);
  });

  it("puts a 'new' divider before the first unread comment of the other person, starting a group", () => {
    const entries = groupThread([c("b", 0), c("b", MIN), c("b", 2 * MIN), c("a", 3 * MIN)], {
      me: "a",
      dividerAt: MIN,
    });
    expect(entries.map((e) => e.kind)).toEqual(["group", "new", "group", "group"]);
    const [first, , after] = entries;
    expect(first?.kind === "group" && first.comments).toHaveLength(2);
    expect(after?.kind === "group" && after.comments).toHaveLength(1);
  });

  it("has no divider when everything is read, or when only you wrote", () => {
    expect(groupThread([c("b", 0)], { me: "a", dividerAt: 5 }).some((e) => e.kind === "new")).toBe(false);
    expect(groupThread([c("a", 9)], { me: "a", dividerAt: null }).some((e) => e.kind === "new")).toBe(false);
    expect(groupThread([c("b", 9)], { me: "a", dividerAt: null }).some((e) => e.kind === "new")).toBe(true);
    expect(groupThread([], { me: "a", dividerAt: null })).toEqual([]);
  });
});

describe("isUnread", () => {
  it("is the other person's comments after the read time", () => {
    expect(isUnread({ authorId: "b", createdAt: 10 }, "a", 10)).toBe(false);
    expect(isUnread({ authorId: "b", createdAt: 11 }, "a", 10)).toBe(true);
    expect(isUnread({ authorId: "a", createdAt: 11 }, "a", 10)).toBe(false);
    expect(isUnread({ authorId: "b", createdAt: 1 }, "a", null)).toBe(true);
  });
});

describe("commentPushText", () => {
  it("names who and where, with the comment", () => {
    expect(commentPushText("Marie", "Tugboat", ["Started it tonight,\n the first layer looked great."])).toEqual({
      title: "Marie on Tugboat",
      body: "Started it tonight, the first layer looked great.",
    });
  });

  it("batches a burst into the count and the latest", () => {
    expect(commentPushText("Marie", "Tugboat", ["One", "Two", "Latest one"])).toEqual({
      title: "Marie on Tugboat",
      body: "3 new comments. Latest one",
    });
  });

  it("clips long comments and copes with no title", () => {
    const { title, body } = commentPushText("Marie", "  ", ["x".repeat(300)]);
    expect(title).toBe("Marie on an idea");
    expect(body.length).toBeLessThanOrEqual(110);
    expect(body.endsWith("…")).toBe(true);
  });

  it("waits a short while to batch, and opens the right page", () => {
    expect(PUSH_BATCH_MS).toBeLessThanOrEqual(30_000);
    expect(threadUrl("abc", "idea")).toBe("/ideas/abc?thread=1");
    expect(threadUrl("abc", "building")).toBe("/builds/abc?thread=1");
  });
});

describe("splitTrailingLink", () => {
  it("takes a link that ends the message, or is all of it, and leaves one mid-sentence", () => {
    expect(splitTrailingLink("These fit https://example.com/a/b")).toEqual({
      text: "These fit",
      url: "https://example.com/a/b",
    });
    expect(splitTrailingLink("https://example.com/a  ")).toEqual({ text: "", url: "https://example.com/a" });
    expect(splitTrailingLink("See https://example.com/a for the grid").url).toBeNull();
    expect(splitTrailingLink("no link here")).toEqual({ text: "no link here", url: null });
    // The last link is the one that becomes a card, the earlier one stays in the text.
    expect(splitTrailingLink("a https://x.com/1 and https://x.com/2")).toEqual({
      text: "a https://x.com/1 and",
      url: "https://x.com/2",
    });
  });
});

describe("unreadLine", () => {
  const thread = {
    itemId: "i",
    count: 1,
    latestAt: 1,
    latestId: "c",
    latestAuthorId: "m",
    latestBody: "Started it tonight",
    title: "Tugboat",
    stage: "building",
  };
  const name = () => "Marie";
  it("quotes the one comment, or counts when there are several", () => {
    expect(unreadLine([thread], name)).toMatchObject({ lead: "Marie on Tugboat", quote: "Started it tonight" });
    expect(
      unreadLine(
        [
          { ...thread, count: 2 },
          { ...thread, itemId: "j" },
        ],
        name,
      )?.lead,
    ).toBe("3 new comments · latest from Marie on Tugboat");
  });
  it("names an untitled thread by its stage, and says nothing when all is read or the copy is old", () => {
    expect(unreadLine([{ ...thread, title: null, stage: "idea" }], name)?.lead).toBe("Marie on an idea");
    expect(unreadLine([], name)).toBeNull();
    expect(unreadLine([{ itemId: "i", count: 1, latestAt: 1 }], name)).toBeNull();
  });
});
