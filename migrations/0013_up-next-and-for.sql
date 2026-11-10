ALTER TABLE `items` ADD `up_next` integer;--> statement-breakpoint
ALTER TABLE `items` ADD `for_whom` text;
CREATE TRIGGER `search_items_insert` AFTER INSERT ON `items` BEGIN
	INSERT INTO search (kind, ref_id, item_id, title, body, tags)
	VALUES ('item', NEW.id, NEW.id, coalesce(NEW.title, ''), NEW.note, coalesce(NEW.for_whom, ''));
END;
--> statement-breakpoint
CREATE TRIGGER `search_items_for` AFTER UPDATE OF for_whom ON `items` WHEN OLD.for_whom IS NOT NEW.for_whom BEGIN
	UPDATE search SET tags = coalesce(NEW.for_whom, '') WHERE kind = 'item' AND ref_id = NEW.id;
END;
