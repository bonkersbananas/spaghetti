CREATE TABLE `shopping_items` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`link` text,
	`price_link` text,
	`position` integer NOT NULL,
	`bought_at` integer,
	`bought_by` text,
	`created_by` text NOT NULL,
	`created_via` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`bought_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
