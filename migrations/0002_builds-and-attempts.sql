CREATE TABLE `attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`outcome` text,
	`printed_at` integer NOT NULL,
	`finished_at` integer,
	`note` text DEFAULT '' NOT NULL,
	`failure_tags` text DEFAULT '[]' NOT NULL,
	`success_notes` text DEFAULT '[]' NOT NULL,
	`settings` text DEFAULT '{}' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `attempts_item_printed_idx` ON `attempts` (`item_id`,`printed_at`);--> statement-breakpoint
CREATE TABLE `tags` (
	`kind` text NOT NULL,
	`slug` text NOT NULL,
	`label` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`kind`, `slug`),
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `items` ADD `started_at` integer;--> statement-breakpoint
ALTER TABLE `items` ADD `finished_at` integer;--> statement-breakpoint
ALTER TABLE `items` ADD `cover_photo_id` text;--> statement-breakpoint
ALTER TABLE `photos` ADD `attempt_id` text REFERENCES attempts(id) ON DELETE cascade;