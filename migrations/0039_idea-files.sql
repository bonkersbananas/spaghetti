CREATE TABLE `item_files` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`name` text NOT NULL,
	`size` integer NOT NULL,
	`stored` integer NOT NULL,
	`has_thumb` integer NOT NULL,
	`plate` integer NOT NULL,
	`plate_count` integer NOT NULL,
	`slicer` text,
	`prefill` text NOT NULL,
	`objects` text DEFAULT '[]' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `item_files_item_idx` ON `item_files` (`item_id`);