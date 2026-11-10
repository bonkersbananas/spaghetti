CREATE TABLE `recipes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`material` text NOT NULL,
	`finish` text,
	`settings` text DEFAULT '{}' NOT NULL,
	`source_attempt_id` text,
	`source_item_id` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
