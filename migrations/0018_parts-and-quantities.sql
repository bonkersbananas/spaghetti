CREATE TABLE `parts` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`name` text NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`photo_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `parts_item_idx` ON `parts` (`item_id`,`position`);--> statement-breakpoint
ALTER TABLE `attempt_files` ADD `objects` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `attempts` ADD `parts` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
-- A build's part names are searchable ("hull" finds the build): they go in the item row's tags column, after "for whom".
CREATE VIEW `search_item_tags` AS
SELECT
	i.id AS item_id,
	trim(coalesce(i.for_whom, '') || ' ' || coalesce((SELECT group_concat(p.name, ' ') FROM parts AS p WHERE p.item_id = i.id), '')) AS tags
FROM items AS i;
--> statement-breakpoint
DROP TRIGGER `search_items_for`;
--> statement-breakpoint
CREATE TRIGGER `search_items_for` AFTER UPDATE OF for_whom ON `items` WHEN OLD.for_whom IS NOT NEW.for_whom BEGIN
	UPDATE search SET tags = (SELECT tags FROM search_item_tags WHERE item_id = NEW.id) WHERE kind = 'item' AND ref_id = NEW.id;
END;
--> statement-breakpoint
CREATE TRIGGER `search_parts_insert` AFTER INSERT ON `parts` BEGIN
	UPDATE search SET tags = (SELECT tags FROM search_item_tags WHERE item_id = NEW.item_id) WHERE kind = 'item' AND ref_id = NEW.item_id;
END;
--> statement-breakpoint
CREATE TRIGGER `search_parts_name` AFTER UPDATE OF name ON `parts` WHEN OLD.name IS NOT NEW.name BEGIN
	UPDATE search SET tags = (SELECT tags FROM search_item_tags WHERE item_id = NEW.item_id) WHERE kind = 'item' AND ref_id = NEW.item_id;
END;
--> statement-breakpoint
CREATE TRIGGER `search_parts_delete` AFTER DELETE ON `parts` BEGIN
	UPDATE search SET tags = (SELECT tags FROM search_item_tags WHERE item_id = OLD.item_id) WHERE kind = 'item' AND ref_id = OLD.item_id;
END;
