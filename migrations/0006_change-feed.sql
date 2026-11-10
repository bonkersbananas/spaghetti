CREATE TABLE `changes` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`item_id` text,
	`action` text NOT NULL,
	`actor_kind` text NOT NULL,
	`actor_id` text NOT NULL,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `changes_at_idx` ON `changes` (`at`);