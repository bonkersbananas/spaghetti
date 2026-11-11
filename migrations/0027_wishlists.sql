CREATE TABLE `wishlist_entries` (
	`user_id` text NOT NULL,
	`item_id` text NOT NULL,
	`position` integer NOT NULL,
	`added_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `item_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `users` ADD `wishlist_private` integer DEFAULT false NOT NULL;