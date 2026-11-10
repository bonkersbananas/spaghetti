CREATE TABLE `draft_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `item_drafts` (
	`item_id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`site` text NOT NULL,
	`status` text NOT NULL,
	`failure` text,
	`claimed_at` integer,
	`tries` integer DEFAULT 0 NOT NULL,
	`result` text,
	`applied` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`drafted_at` integer,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
