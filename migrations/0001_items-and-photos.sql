CREATE TABLE `items` (
	`id` text PRIMARY KEY NOT NULL,
	`stage` text DEFAULT 'idea' NOT NULL,
	`title` text,
	`note` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `items_stage_created_idx` ON `items` (`stage`,`created_at`);--> statement-breakpoint
CREATE TABLE `photos` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`position` integer NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`color` text NOT NULL,
	`content_type` text NOT NULL,
	`taken_at` integer,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`item_id`) REFERENCES `items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `photos_item_idx` ON `photos` (`item_id`,`position`);