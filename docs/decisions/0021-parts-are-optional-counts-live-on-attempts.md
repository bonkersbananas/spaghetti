# 0021. Parts are optional, and good-piece counts live on attempts

Status: Accepted

**Decision:**
- A build has no parts unless someone adds them (or takes them from its slicer file); a build without them works and looks as it did. A part is a name, a quantity needed and optionally one of the build's photos.
- An attempt records what it printed as `[{ partId, count }]`. Progress is derived (the sum of counts over finished attempts), never stored. Worked and partly worked prints count their pieces; a spaghetti counts none unless a number is set (the server zeroes counts when a print becomes a spaghetti and none were sent). A print still printing counts nothing yet.
- Parts from a file: the plate's object names are kept with the attempt's file; identical objects (after tidying copy numbers and separators) become one part with a quantity. Only offered when the file yields more than one part or a quantity above one.
- When every part is printed the build page offers to finish the build; it never does it by itself.
- Removing a part deletes the row (the undo puts it back under the same id); attempts keep their counts, which show nothing without the part.

**Why:** most builds are one thing, so parts must cost nothing when unused; counts on attempts keep "what did this plate make" next to the print that made it, and a derived progress can't drift.

**Consequences:** part names go in the search index with the item row's tags. Agents can add and change parts and send counts, not remove parts.
