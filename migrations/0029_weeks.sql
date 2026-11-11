CREATE TABLE `week_pushes` (
	`monday` text NOT NULL,
	`user_id` text NOT NULL,
	`sent_at` integer NOT NULL,
	PRIMARY KEY(`monday`, `user_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `weeks` (
	`monday` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`text` text,
	`claimed_at` integer,
	`tries` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`ran_at` integer,
	`run_outcome` text,
	`detail` text
);
--> statement-breakpoint
ALTER TABLE `push_subscriptions` ADD `week_nudges` integer DEFAULT true NOT NULL;