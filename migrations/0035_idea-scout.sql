CREATE TABLE `scout_picks` (
	`id` text PRIMARY KEY NOT NULL,
	`monday` text NOT NULL,
	`position` integer NOT NULL,
	`key` text NOT NULL,
	`url` text NOT NULL,
	`site` text NOT NULL,
	`title` text NOT NULL,
	`why` text NOT NULL,
	`picture_type` text,
	`picture_width` integer,
	`picture_height` integer,
	`status` text DEFAULT 'suggested' NOT NULL,
	`item_id` text,
	`decided_by` text,
	`decided_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scout_picks_key_unique` ON `scout_picks` (`key`);--> statement-breakpoint
CREATE INDEX `scout_picks_monday_idx` ON `scout_picks` (`monday`,`position`);--> statement-breakpoint
CREATE TABLE `scout_rounds` (
	`monday` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`claimed_at` integer,
	`tries` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`ran_at` integer,
	`run_outcome` text,
	`detail` text
);
