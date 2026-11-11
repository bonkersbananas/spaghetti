# 0027. Each person keeps a ranked wishlist of ideas, shared by default

Status: Accepted

**Decision:**
- Each person has one **wishlist**: the ideas they would print first, in their order (`wishlist_entries`, `users.wishlist_private`). It sits beside the shared Up next queue, which stays the "what we print soon" list for both of you; a wishlist is one person's say.
- It is **shared with everyone who signs in** unless its owner turns "Show it to …" off. Someone else's private list comes back with `private: true` and no entries. Only the owner changes a list; agent tokens can read lists (`read`) but never change them.
- Only ideas are on a list. An idea that is deleted or becomes a build is hidden, not removed, so restoring it or undoing "Start building" puts it back in its slot. At most 50 per list.
- Reordering is drag and drop by a handle (mouse and touch, through `motion`'s Reorder) and the arrow keys on the focused handle; Delete takes one off with an undo. Every row has "Start building", which starts the build and opens it.
- Phones reach `/wishlist` from a row at the top of Ideas (the tab bar keeps its four places); desktop has it in the sidebar (`G W`).
- The change feed records a `wishlist` change with the owner's id and no item, so a private list's contents never reach the other person's feed or webhooks.

**Why:** xixa asked for a per-person list of top ideas, public to the other person by default, quick to reorder and one step from a build.

**Consequences:** the Ideas card menu and the idea page have "Add to your wishlist" / "My wishlist". The list is not searchable and has no MCP tool yet.
