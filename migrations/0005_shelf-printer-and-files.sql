CREATE TABLE `ams_slots` (
	`slot` text PRIMARY KEY NOT NULL,
	`spool_id` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`spool_id`) REFERENCES `spools`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`updated_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ams_slots_spool_id_unique` ON `ams_slots` (`spool_id`);--> statement-breakpoint
CREATE TABLE `attempt_files` (
	`id` text PRIMARY KEY NOT NULL,
	`attempt_id` text NOT NULL,
	`name` text NOT NULL,
	`size` integer NOT NULL,
	`stored` integer NOT NULL,
	`has_thumb` integer NOT NULL,
	`plate` integer NOT NULL,
	`plate_count` integer NOT NULL,
	`slicer` text,
	`prefill` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`attempt_id`) REFERENCES `attempts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `attempt_files_attempt_idx` ON `attempt_files` (`attempt_id`);--> statement-breakpoint
CREATE TABLE `printer` (
	`id` text PRIMARY KEY NOT NULL,
	`setup` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `spools` (
	`id` text PRIMARY KEY NOT NULL,
	`material` text NOT NULL,
	`brand` text,
	`color_name` text,
	`color_hex` text,
	`finish` text,
	`remaining` text DEFAULT 'full' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`dried_at` integer,
	`photo_id` text,
	`photo_width` integer,
	`photo_height` integer,
	`photo_color` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `spools_material_idx` ON `spools` (`material`);