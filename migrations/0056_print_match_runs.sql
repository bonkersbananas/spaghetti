CREATE TABLE `print_match_runs` (
	`attempt_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`candidate_ids` text DEFAULT '[]' NOT NULL,
	`item_id` text,
	`reason` text,
	`created_at` integer NOT NULL,
	`ran_at` integer,
	`run_outcome` text,
	`detail` text,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `print_match_runs_ran_idx` ON `print_match_runs` (`ran_at`);