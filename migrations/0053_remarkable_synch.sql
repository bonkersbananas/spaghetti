ALTER TABLE `print_jobs` ADD `filled` text;--> statement-breakpoint
ALTER TABLE `print_jobs` ADD `own_settings` integer DEFAULT false NOT NULL;