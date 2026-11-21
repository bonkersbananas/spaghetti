CREATE TABLE `attempt_moves` (
	`id` text PRIMARY KEY NOT NULL,
	`attempt_id` text NOT NULL,
	`from_item_id` text NOT NULL,
	`to_item_id` text NOT NULL,
	`from_title` text,
	`from_removed` integer DEFAULT false NOT NULL,
	`to_started` integer DEFAULT false NOT NULL,
	`to_made` integer DEFAULT false NOT NULL,
	`photos` text DEFAULT '[]' NOT NULL,
	`parts` text DEFAULT '[]' NOT NULL,
	`was_asking` integer,
	`moved_by` text NOT NULL,
	`moved_via` text,
	`moved_at` integer NOT NULL,
	`to_up_next` integer,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`moved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `attempt_moves_attempt_idx` ON `attempt_moves` (`attempt_id`,`moved_at`);--> statement-breakpoint
CREATE TABLE `file_downloads` (
	`id` text PRIMARY KEY NOT NULL,
	`file_id` text NOT NULL,
	`item_id` text NOT NULL,
	`how` text NOT NULL,
	`user_id` text NOT NULL,
	`at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `file_downloads_item_at_idx` ON `file_downloads` (`item_id`,`at`);--> statement-breakpoint
CREATE TABLE `print_jobs` (
	`attempt_id` text PRIMARY KEY NOT NULL,
	`name` text,
	`gcode_file` text,
	`plate` integer,
	`estimate_minutes` integer,
	`file_id` text,
	`placed` text NOT NULL,
	`reasons` text DEFAULT '[]' NOT NULL,
	`item_id` text NOT NULL,
	`own_item_id` text,
	`own_title` text,
	`asking` integer DEFAULT false NOT NULL,
	`started_idea` integer DEFAULT false NOT NULL,
	`idea_up_next` integer,
	`created_at` integer NOT NULL,
	`settled_at` integer,
	`settled_by` text,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `items` ADD `merged_into` text;--> statement-breakpoint
-- The prints the printer bridge filed in a build of its own before the app could match them (decision 0076): their
-- builds ask "which build is this?" from now on. Only a printer's build with just that print, from the last 30 days.
INSERT OR IGNORE INTO `print_jobs` (`attempt_id`, `name`, `placed`, `reasons`, `item_id`, `own_title`, `asking`, `created_at`)
SELECT a.`id`, i.`title`, 'new', '[]', i.`id`, i.`title`, 1, a.`created_at`
FROM `attempts` AS a
JOIN `items` AS i ON i.`id` = a.`item_id`
WHERE a.`deleted_at` IS NULL
	AND i.`deleted_at` IS NULL
	AND i.`stage` = 'building'
	AND a.`created_via` IS NOT NULL
	AND a.`created_via` = i.`created_via`
	AND a.`created_via` IN (SELECT `agent_id` FROM `bridge` WHERE `agent_id` IS NOT NULL)
	AND a.`created_at` >= (unixepoch() - 30 * 86400) * 1000
	AND (SELECT count(*) FROM `attempts` AS b WHERE b.`item_id` = i.`id` AND b.`deleted_at` IS NULL) = 1;
