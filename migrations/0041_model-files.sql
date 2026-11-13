ALTER TABLE `attempt_files` ADD `kind` text DEFAULT 'slicer' NOT NULL;--> statement-breakpoint
ALTER TABLE `attempt_files` ADD `slice` text;--> statement-breakpoint
ALTER TABLE `item_files` ADD `kind` text DEFAULT 'slicer' NOT NULL;--> statement-breakpoint
ALTER TABLE `item_files` ADD `slice` text;