# 0032. Search reads questions, in the Worker, on the index it has

Status: Accepted

**Decision:** The search box takes questions as people type them ("what worked for the paddle steamer", "spaghetti last week", "Sam's idea about the clips", "skevhet", "0,4 nozzle"). The Worker reads the question (`shared/search-intent.ts`) before it reaches FTS5: filler words are dropped (English and Swedish), "worked" and "failed" become a ranking preference instead of a required word, a time phrase becomes a date range, a first name becomes a person filter that falls back to a plain word when it finds nothing, Swedish and English twins expand to `("skev"* OR "warping"*)`, and, only when nothing matched, a mistyped word is corrected against the notebook's own words (titles, notes, tags, spools) by edit distance.

**Why:** Search is one of the three goals; the index existed but a question with one extra word ("what", "last week") returned nothing, and the settings' numbers weren't in it. Doing the reading in the Worker keeps the index a plain FTS5 table that triggers fill, and keeps both people's phones fast (no vocabulary or dictionary is downloaded).

**Consequences:** No fuzzy index, no trigram table and no `fts5vocab` (its support on D1 isn't relied on): typo help is a fallback that runs only on an empty answer. Time phrases use the workspace time zone and Monday weeks of the week pages (decision 0030), not the phone's. The Swedish table is small and hand-kept; add a row when a word is missed. Claude's photo guesses and the week paragraphs are not indexed: a guess that was confirmed is the attempt's own tag, and a week is reached by "last week". Revisit the index (a second FTS table with trigrams) if typos on a *prefix being typed* become a real complaint.
