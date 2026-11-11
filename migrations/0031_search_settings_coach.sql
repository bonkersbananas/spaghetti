-- Search learns what the settings say and what Claude's coach suggested (docs/design.md "Search").
--
-- An attempt's row now also holds its numbers as words ("bed temperature 70", "nozzle diameter 0.4 mm",
-- "layer height 0.2", "infill 15", "walls 3"), so "PETG bed temp" and "0.4 nozzle" find the attempts that used
-- them, and the failure coach's open suggestions ("Dry the filament first"), so a failed print is found by what
-- was suggested for the next try. A dismissed suggestion drops out. The coach row's triggers refresh the
-- attempt's row when a suggestion arrives or is dismissed; everything else about the index is as in 0003.
DROP VIEW `search_attempt_docs`;
--> statement-breakpoint
CREATE VIEW `search_attempt_docs` AS
SELECT
	a.id AS ref_id,
	a.item_id AS item_id,
	coalesce(i.title, '') AS title,
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
CREATE TRIGGER `search_coach_insert` AFTER INSERT ON `coach_runs` BEGIN
	DELETE FROM search WHERE kind = 'attempt' AND ref_id = NEW.attempt_id;
	INSERT INTO search (kind, ref_id, item_id, title, body, tags, materials, settings)
	SELECT 'attempt', ref_id, item_id, title, body, tags, materials, settings FROM search_attempt_docs WHERE ref_id = NEW.attempt_id;
END;
--> statement-breakpoint
CREATE TRIGGER `search_coach_update` AFTER UPDATE OF status, suggestions, dismissed ON `coach_runs` BEGIN
	DELETE FROM search WHERE kind = 'attempt' AND ref_id = NEW.attempt_id;
	INSERT INTO search (kind, ref_id, item_id, title, body, tags, materials, settings)
	SELECT 'attempt', ref_id, item_id, title, body, tags, materials, settings FROM search_attempt_docs WHERE ref_id = NEW.attempt_id;
END;
--> statement-breakpoint
-- Every attempt already written, read again with the new view.
DELETE FROM search WHERE kind = 'attempt';
--> statement-breakpoint
INSERT INTO search (kind, ref_id, item_id, title, body, tags, materials, settings)
SELECT 'attempt', ref_id, item_id, title, body, tags, materials, settings FROM search_attempt_docs;
