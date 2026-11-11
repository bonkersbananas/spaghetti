CREATE TABLE `label_reads` (
	`photo_id` text PRIMARY KEY NOT NULL,
	`spool_id` text NOT NULL,
	`status` text NOT NULL,
	`placeholders` text DEFAULT '[]' NOT NULL,
	`found` text,
	`claimed_at` integer,
	`tries` integer DEFAULT 0 NOT NULL,
	`created_by` text,
	`created_at` integer NOT NULL,
	`ran_at` integer,
	`run_outcome` text,
	`detail` text,
	FOREIGN KEY (`spool_id`) REFERENCES `spools`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `label_reads_spool_idx` ON `label_reads` (`spool_id`);--> statement-breakpoint
ALTER TABLE `spools` ADD `diameter_mm` real;--> statement-breakpoint
ALTER TABLE `spools` ADD `nozzle_temp_min` integer;--> statement-breakpoint
ALTER TABLE `spools` ADD `nozzle_temp_max` integer;--> statement-breakpoint
ALTER TABLE `spools` ADD `bed_temp_min` integer;--> statement-breakpoint
ALTER TABLE `spools` ADD `bed_temp_max` integer;--> statement-breakpoint
ALTER TABLE `spools` ADD `dry_temp_c` integer;--> statement-breakpoint
ALTER TABLE `spools` ADD `dry_hours` integer;--> statement-breakpoint
ALTER TABLE `spools` ADD `product_code` text;--> statement-breakpoint
ALTER TABLE `spools` ADD `label_fields` text DEFAULT '[]' NOT NULL;