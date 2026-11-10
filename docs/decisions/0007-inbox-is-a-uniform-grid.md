# 0007. The inbox is a uniform 4:5 grid, not masonry

Status: Accepted

**Decision:** Ideas are shown as cards in an even grid, every picture cropped to 4:5 portrait. Cards without a photo are note cards of the same size.

**Why:** a grid reads calmly and scans quickly, and keeps rows aligned on desktop and phone. Masonry looks lively but jumps while photos load and makes it hard to compare cards.

**Consequences:** cards use `aspect="portrait"`; the photo viewer shows the full picture. A different layout (a list view, say) is added beside the grid, not instead of it.
