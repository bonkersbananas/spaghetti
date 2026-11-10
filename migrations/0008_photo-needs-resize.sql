ALTER TABLE `photos` ADD `needs_resize` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `photos` ADD `resize_claimed_at` integer;