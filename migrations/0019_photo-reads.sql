CREATE TABLE `photo_reads` (
	`photo_id` text PRIMARY KEY NOT NULL,
	`attempt_id` text NOT NULL,
	`item_id` text NOT NULL,
	`status` text NOT NULL,
	`outcome` text,
	`failure_tags` text DEFAULT '[]' NOT NULL,
	`success_notes` text DEFAULT '[]' NOT NULL,
	`reason` text,
	`claimed_at` integer,
	`tries` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`ran_at` integer,
	`run_outcome` text,
	`detail` text,
	FOREIGN KEY (`photo_id`) REFERENCES `photos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `photo_reads_attempt_idx` ON `photo_reads` (`attempt_id`,`created_at`);