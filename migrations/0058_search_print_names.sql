-- Search finds a print by the name the printer gave it ("gnome_hat_3color(5)", "ring-test-v2").
--
-- Prints made at the printer are filed under builds that have no title of their own, and a build's title is
-- often the model's page title, while the file the person actually sliced is called something else. The
-- name lives in print_jobs.name, which the index didn't read. A new `printed` column holds it: an attempt's row
-- has its own print's name, an item's row the names of all its live attempts' prints (so the build is found,
-- not only the attempt). FTS5 can't add a column, so the index is rebuilt (the same way 0003 and 0031 filled it).
DROP TABLE `search`;
--> statement-breakpoint
CREATE VIRTUAL TABLE `search` USING fts5(
	kind UNINDEXED,
	ref_id UNINDEXED,
	item_id UNINDEXED,
	title,
	body,
	tags,
	materials,
	settings,
	printed,
	tokenize = 'unicode61 remove_diacritics 2',
	prefix = '2 3'
);
--> statement-breakpoint
CREATE VIEW `search_item_printed` AS
SELECT
	i.id AS item_id,
	coalesce((
		SELECT group_concat(DISTINCT j.name)
		FROM attempts AS a JOIN print_jobs AS j ON j.attempt_id = a.id
		WHERE a.item_id = i.id AND a.deleted_at IS NULL AND j.name IS NOT NULL
	), '') AS printed
FROM items AS i;
--> statement-breakpoint
DROP VIEW `search_attempt_docs`;
--> statement-breakpoint
CREATE VIEW `search_attempt_docs` AS
SELECT
	a.id AS ref_id,
	a.item_id AS item_id,
	coalesce(i.title, '') AS title,
	coalesce((SELECT j.name FROM print_jobs AS j WHERE j.attempt_id = a.id), '') AS printed,
	trim(a.note || ' ' || coalesce((
		SELECT group_concat(coalesce(json_extract(s.value, '$.title'), '') || ' ' || coalesce(json_extract(s.value, '$.why'), ''), ' ')
		FROM coach_runs AS c, json_each(c.suggestions) AS s
		WHERE c.attempt_id = a.id AND c.status = 'done'
			AND json_extract(s.value, '$.id') NOT IN (SELECT value FROM json_each(c.dismissed))
	), '')) AS body,
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
		CASE WHEN json_extract(a.settings, '$.filamentDried') THEN 'dried' ELSE '' END || ' ' ||
		coalesce('bed temperature ' || json_extract(a.settings, '$.bedTemperature') || ' ', '') ||
		coalesce('nozzle temperature ' || json_extract(a.settings, '$.nozzleTemperature') || ' ', '') ||
		coalesce('chamber temperature ' || json_extract(a.settings, '$.chamberTemperature') || ' ', '') ||
		coalesce('nozzle diameter ' || json_extract(a.settings, '$.nozzleDiameter') || ' mm ', '') ||
		coalesce('layer height ' || json_extract(a.settings, '$.layerHeight') || ' mm ', '') ||
		coalesce('infill ' || json_extract(a.settings, '$.infillDensity') || ' ', '') ||
		coalesce('walls ' || json_extract(a.settings, '$.wallLoops') || ' ', '')
	) AS settings
FROM attempts AS a
JOIN items AS i ON i.id = a.item_id;
--> statement-breakpoint
DROP TRIGGER `search_attempts_insert`;
--> statement-breakpoint
CREATE TRIGGER `search_attempts_insert` AFTER INSERT ON `attempts` BEGIN
	INSERT INTO search (kind, ref_id, item_id, title, body, tags, materials, settings, printed)
	SELECT 'attempt', ref_id, item_id, title, body, tags, materials, settings, printed FROM search_attempt_docs WHERE ref_id = NEW.id;
END;
--> statement-breakpoint
DROP TRIGGER `search_attempts_update`;
--> statement-breakpoint
CREATE TRIGGER `search_attempts_update` AFTER UPDATE OF note, outcome, failure_tags, success_notes, settings, item_id ON `attempts` BEGIN
	DELETE FROM search WHERE kind = 'attempt' AND ref_id = OLD.id;
	INSERT INTO search (kind, ref_id, item_id, title, body, tags, materials, settings, printed)
	SELECT 'attempt', ref_id, item_id, title, body, tags, materials, settings, printed FROM search_attempt_docs WHERE ref_id = NEW.id;
END;
--> statement-breakpoint
DROP TRIGGER `search_coach_insert`;
--> statement-breakpoint
CREATE TRIGGER `search_coach_insert` AFTER INSERT ON `coach_runs` BEGIN
	DELETE FROM search WHERE kind = 'attempt' AND ref_id = NEW.attempt_id;
	INSERT INTO search (kind, ref_id, item_id, title, body, tags, materials, settings, printed)
	SELECT 'attempt', ref_id, item_id, title, body, tags, materials, settings, printed FROM search_attempt_docs WHERE ref_id = NEW.attempt_id;
END;
--> statement-breakpoint
DROP TRIGGER `search_coach_update`;
--> statement-breakpoint
CREATE TRIGGER `search_coach_update` AFTER UPDATE OF status, suggestions, dismissed ON `coach_runs` BEGIN
	DELETE FROM search WHERE kind = 'attempt' AND ref_id = NEW.attempt_id;
	INSERT INTO search (kind, ref_id, item_id, title, body, tags, materials, settings, printed)
	SELECT 'attempt', ref_id, item_id, title, body, tags, materials, settings, printed FROM search_attempt_docs WHERE ref_id = NEW.attempt_id;
END;
--> statement-breakpoint
-- A print's name arrives (or changes, or goes) after its attempt exists: its attempt's row and its build's row follow.
CREATE TRIGGER `search_print_insert` AFTER INSERT ON `print_jobs` BEGIN
	UPDATE search SET printed = coalesce(NEW.name, '') WHERE kind = 'attempt' AND ref_id = NEW.attempt_id;
	UPDATE search SET printed = (SELECT printed FROM search_item_printed WHERE item_id = search.ref_id)
	WHERE kind = 'item' AND ref_id = (SELECT item_id FROM attempts WHERE id = NEW.attempt_id);
END;
--> statement-breakpoint
CREATE TRIGGER `search_print_name` AFTER UPDATE OF name ON `print_jobs` WHEN OLD.name IS NOT NEW.name BEGIN
	UPDATE search SET printed = coalesce(NEW.name, '') WHERE kind = 'attempt' AND ref_id = NEW.attempt_id;
	UPDATE search SET printed = (SELECT printed FROM search_item_printed WHERE item_id = search.ref_id)
	WHERE kind = 'item' AND ref_id = (SELECT item_id FROM attempts WHERE id = NEW.attempt_id);
END;
--> statement-breakpoint
CREATE TRIGGER `search_print_delete` AFTER DELETE ON `print_jobs` BEGIN
	UPDATE search SET printed = '' WHERE kind = 'attempt' AND ref_id = OLD.attempt_id;
	UPDATE search SET printed = (SELECT printed FROM search_item_printed WHERE item_id = search.ref_id)
	WHERE kind = 'item' AND ref_id = (SELECT item_id FROM attempts WHERE id = OLD.attempt_id);
END;
--> statement-breakpoint
-- An attempt moved to another build, removed or brought back takes its print's name with it.
CREATE TRIGGER `search_attempts_printed` AFTER UPDATE OF item_id, deleted_at ON `attempts` BEGIN
	UPDATE search SET printed = (SELECT printed FROM search_item_printed WHERE item_id = search.ref_id)
	WHERE kind = 'item' AND ref_id IN (OLD.item_id, NEW.item_id);
END;
--> statement-breakpoint
CREATE TRIGGER `search_attempts_gone` AFTER DELETE ON `attempts` BEGIN
	UPDATE search SET printed = (SELECT printed FROM search_item_printed WHERE item_id = search.ref_id)
	WHERE kind = 'item' AND ref_id = OLD.item_id;
END;
--> statement-breakpoint
-- Everything already written, read into the new index.
INSERT INTO search (kind, ref_id, item_id, title, body, tags, printed)
SELECT 'item', i.id, i.id, coalesce(i.title, ''), i.note, t.tags, p.printed
FROM items AS i JOIN search_item_tags AS t ON t.item_id = i.id JOIN search_item_printed AS p ON p.item_id = i.id;
--> statement-breakpoint
INSERT INTO search (kind, ref_id, item_id, title, body, tags, materials, settings, printed)
SELECT 'attempt', ref_id, item_id, title, body, tags, materials, settings, printed FROM search_attempt_docs;
--> statement-breakpoint
INSERT INTO search (kind, ref_id, item_id, title, body)
SELECT 'comment', c.id, c.item_id, coalesce(i.title, ''), c.body FROM comments AS c JOIN items AS i ON i.id = c.item_id WHERE c.deleted_at IS NULL;
