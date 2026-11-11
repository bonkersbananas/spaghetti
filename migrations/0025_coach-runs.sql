CREATE TABLE `coach_runs` (
	`attempt_id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`status` text NOT NULL,
	`suggestions` text DEFAULT '[]' NOT NULL,
	`dismissed` text DEFAULT '[]' NOT NULL,
	`claimed_at` integer,
	`tries` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`ran_at` integer,
	`run_outcome` text,
	`detail` text,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE cascade
);
