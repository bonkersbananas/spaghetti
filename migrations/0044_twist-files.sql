CREATE TABLE `twist_files` (
	`id` text PRIMARY KEY NOT NULL,
	`twist_id` text NOT NULL,
	`name` text NOT NULL,
	`size` integer NOT NULL,
	`stored` integer NOT NULL,
	`has_thumb` integer NOT NULL,
	`plate` integer NOT NULL,
	`plate_count` integer NOT NULL,
	`slicer` text,
	`prefill` text NOT NULL,
	`objects` text DEFAULT '[]' NOT NULL,
	`kind` text DEFAULT 'slicer' NOT NULL,
	`slice` text,
	`slicing` text,
	`previous_slice` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`twist_id`) REFERENCES `twists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `twist_files_twist_idx` ON `twist_files` (`twist_id`);