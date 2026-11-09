-- One full-text index (SQLite FTS5) over ideas, builds and print attempts,
-- kept up to date by triggers. Written by hand: drizzle-kit doesn't know
-- virtual tables, so the Drizzle schema doesn't mention it and queries use
-- raw SQL (src/worker/routes/search.ts).
--
-- One row per item (kind 'item': its title and note) and one per attempt
-- (kind 'attempt': its build's title, its note, tags, filaments and settings),
-- so "PETG warping" matches an attempt that has both. Deleted rows stay
-- indexed until the purge removes them; queries join the live rows.
CREATE VIRTUAL TABLE `search` USING fts5(
	kind UNINDEXED,
	ref_id UNINDEXED,
	item_id UNINDEXED,
	title,
	body,
	tags,
	materials,
	settings,
	tokenize = 'unicode61 remove_diacritics 2',
	prefix = '2 3'
);
--> statement-breakpoint
-- What an attempt's row says. Tag slugs read as words ("bed-adhesion" is
-- "bed adhesion"), and the outcome is spelled out so "spaghetti" finds failures.
CREATE VIEW `search_attempt_docs` AS
SELECT
	a.id AS ref_id,
	a.item_id AS item_id,
	coalesce(i.title, '') AS title,
	a.note AS body,
	trim(
		coalesce((SELECT group_concat(value, ' ') FROM json_each(a.failure_tags)), '') || ' ' ||
		coalesce((SELECT group_concat(value, ' ') FROM json_each(a.success_notes)), '') || ' ' ||
		CASE a.outcome WHEN 'failed' THEN 'spaghetti failed' WHEN 'partial' THEN 'partly' WHEN 'success' THEN 'worked' ELSE '' END
	) AS tags,
	coalesce((
		SELECT group_concat(
			coalesce(json_extract(f.value, '$.type'), '') || ' ' ||
			coalesce(json_extract(f.value, '$.brand'), '') || ' ' ||
			coalesce(json_extract(f.value, '$.colorName'), '') || ' ' ||
			coalesce(json_extract(f.value, '$.profile'), ''),
			' ')
		FROM json_each(a.settings, '$.filaments') AS f
	), '') AS materials,
	trim(
		coalesce(json_extract(a.settings, '$.bedType'), '') || ' ' ||
		coalesce(json_extract(a.settings, '$.processPreset'), '') || ' ' ||
		CASE json_extract(a.settings, '$.nozzle') WHEN 'auxiliary' THEN 'auxiliary nozzle' WHEN 'main' THEN 'main nozzle' ELSE '' END || ' ' ||
		CASE WHEN json_extract(a.settings, '$.supportEnabled') THEN coalesce(json_extract(a.settings, '$.supportType'), '') || ' supports' ELSE '' END || ' ' ||
		CASE WHEN json_extract(a.settings, '$.brim') THEN 'brim' ELSE '' END || ' ' ||
		CASE WHEN json_extract(a.settings, '$.filamentDried') THEN 'dried' ELSE '' END
	) AS settings
FROM attempts AS a
JOIN items AS i ON i.id = a.item_id;
--> statement-breakpoint
CREATE TRIGGER `search_items_insert` AFTER INSERT ON `items` BEGIN
	INSERT INTO search (kind, ref_id, item_id, title, body)
	VALUES ('item', NEW.id, NEW.id, coalesce(NEW.title, ''), NEW.note);
END;
--> statement-breakpoint
CREATE TRIGGER `search_items_note` AFTER UPDATE OF note ON `items` WHEN OLD.note IS NOT NEW.note BEGIN
	UPDATE search SET body = NEW.note WHERE kind = 'item' AND ref_id = NEW.id;
END;
--> statement-breakpoint
-- A build's title is part of each of its attempts' rows.
CREATE TRIGGER `search_items_title` AFTER UPDATE OF title ON `items` WHEN OLD.title IS NOT NEW.title BEGIN
	UPDATE search SET title = coalesce(NEW.title, '') WHERE item_id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER `search_items_delete` AFTER DELETE ON `items` BEGIN
	DELETE FROM search WHERE item_id = OLD.id;
END;
--> statement-breakpoint
CREATE TRIGGER `search_attempts_insert` AFTER INSERT ON `attempts` BEGIN
	INSERT INTO search (kind, ref_id, item_id, title, body, tags, materials, settings)
	SELECT 'attempt', ref_id, item_id, title, body, tags, materials, settings FROM search_attempt_docs WHERE ref_id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER `search_attempts_update` AFTER UPDATE OF note, outcome, failure_tags, success_notes, settings, item_id ON `attempts` BEGIN
	DELETE FROM search WHERE kind = 'attempt' AND ref_id = OLD.id;
	INSERT INTO search (kind, ref_id, item_id, title, body, tags, materials, settings)
	SELECT 'attempt', ref_id, item_id, title, body, tags, materials, settings FROM search_attempt_docs WHERE ref_id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER `search_attempts_delete` AFTER DELETE ON `attempts` BEGIN
	DELETE FROM search WHERE kind = 'attempt' AND ref_id = OLD.id;
END;
--> statement-breakpoint
-- Everything already written before this migration.
INSERT INTO search (kind, ref_id, item_id, title, body)
SELECT 'item', id, id, coalesce(title, ''), note FROM items;
--> statement-breakpoint
INSERT INTO search (kind, ref_id, item_id, title, body, tags, materials, settings)
SELECT 'attempt', ref_id, item_id, title, body, tags, materials, settings FROM search_attempt_docs;
