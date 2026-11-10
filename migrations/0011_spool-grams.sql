CREATE TABLE `spool_weighings` (
	`id` text PRIMARY KEY NOT NULL,
	`spool_id` text NOT NULL,
	`grams_left` integer NOT NULL,
	`on_scale` integer,
	`weighed_at` integer NOT NULL,
	`created_by` text NOT NULL,
	FOREIGN KEY (`spool_id`) REFERENCES `spools`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `spool_weighings_spool_idx` ON `spool_weighings` (`spool_id`,`weighed_at`);--> statement-breakpoint
ALTER TABLE `spools` ADD `net_grams` integer;--> statement-breakpoint
ALTER TABLE `spools` ADD `tare_grams` integer;