# 0034. The shopping list keeps links, not prices

Status: Accepted; the "no prices" part is superseded by [0040](0040-shopping-list-reads-the-prisjakt-pages-people-link.md)

**Decision:** the shopping list (`shopping_items`, `/shopping`) is one shared list of things to buy for the printer. Each thing has a name and, optionally, a shop link and a Prisjakt link that people paste; the app never looks prices up itself. With no Prisjakt link, the thing's sheet offers Prisjakt's search for its name, so the page is one tap to find and one paste to keep. A thing added as a bare link takes its page's title through the link preview. People sort what's still to buy by hand; ticking a thing off moves it to Bought (who and when), unticking puts it back on top, and Clear takes every bought thing off with one Undo.

**Why:** a price changes daily, and reading one would mean scraping Prisjakt from the Worker, which sites like it tend to block (Printables does); a link always works and opens the current price. A hand-made order matches how people shop ("the glue first, it's empty"). Keeping bought things for a while answers "did we already order that?".

**Consequences:** no prices, no totals, no quantities beyond what the name says ("PLA Basic, black ×2"). Agents with the `printer` scope may add, tick off and sort; removing is for people. Follow-ups: "Put it on the shopping list" from the Pantry's Running low, and an MCP tool.
