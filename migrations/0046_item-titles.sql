CREATE TABLE `item_titles` (
	`item_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`title` text,
	`claimed_at` integer,
	`tries` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`ran_at` integer,
	`run_outcome` text,
	`detail` text,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
