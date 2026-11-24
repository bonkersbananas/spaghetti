CREATE TABLE `push_reminders` (
	`attempt_id` text NOT NULL,
	`user_id` text NOT NULL,
	`sent_at` integer NOT NULL,
	PRIMARY KEY(`attempt_id`, `user_id`),
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `users` ADD `push_offer_dismissed_at` integer;