CREATE TABLE `upkeep_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`done_by` text NOT NULL,
	`done_via` text,
	`done_at` integer NOT NULL,
	`printer_hours` real NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`photo_id` text,
	`photo_width` integer,
	`photo_height` integer,
	`photo_color` text,
	`deleted_at` integer,
	FOREIGN KEY (`task_id`) REFERENCES `upkeep_tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`done_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `upkeep_logs_task_idx` ON `upkeep_logs` (`task_id`,`done_at`);--> statement-breakpoint
CREATE TABLE `upkeep_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`interval_hours` integer,
	`interval_days` integer,
	`position` integer NOT NULL,
	`nudged_at` integer,
	`created_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
ALTER TABLE `push_subscriptions` ADD `upkeep_nudges` integer DEFAULT false NOT NULL;