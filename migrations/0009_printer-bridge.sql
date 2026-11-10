CREATE TABLE `bridge` (
	`id` text PRIMARY KEY NOT NULL,
	`last_seen_at` integer NOT NULL,
	`status` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `attempts` ADD `ended_at` integer;--> statement-breakpoint
ALTER TABLE `attempts` ADD `suggested_failure_tag` text;--> statement-breakpoint
ALTER TABLE `spools` ADD `tray_uuid` text;