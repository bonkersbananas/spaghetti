# 0065. Up next stays a compact strip

Status: Accepted

**Decision:** On Ideas, Up next is a strip of small cards (`MiniCard`: the cover, square, about 6.5 rem wide on phones, a 7:5 box at most 11 rem wide on desktop) above the inbox, at every width. It is never shown as large cards or a carousel that leads the page. Making the top of Ideas lighter is done around it: the phone's Wishlists link is one 56 px line, and the model filters are words beside "The rest" rather than a row of chips.

**Why:** Carl Oscar, on Nov 16, when a UI pass proposed making Up next the page's hero: "We already decided previously that up next shouldn't take more space. It hides the actual new ideas we put up. That's why they're small." The strip was made compact on purpose for phones (PR 292) and desktop (PR 299) so that a freshly captured idea is on the first screen.

**Consequences:** Improvements to Up next go into the small cards themselves (titles that hyphenate rather than break mid-word, a note card that fills its face) and the toast (one line, batched for a run of `U`). An audit that proposes bigger Up next cards is answered with this record.
