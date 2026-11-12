CREATE TABLE `shopping_searches` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`at` integer NOT NULL,
	`outcome` text,
	`detail` text
);
--> statement-breakpoint
ALTER TABLE `shopping_items` ADD `suggestion` text;--> statement-breakpoint
ALTER TABLE `shopping_items` ADD `suggestion_claimed_at` integer;--> statement-breakpoint
ALTER TABLE `shopping_items` ADD `suggestion_done_at` integer;--> statement-breakpoint
ALTER TABLE `shopping_items` ADD `suggestion_tried` text;--> statement-breakpoint
ALTER TABLE `shopping_items` ADD `suggestion_rejected` text;