CREATE TABLE `bridge_pairings` (
	`id` text PRIMARY KEY NOT NULL,
	`code_hash` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`agent_id` text,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bridge_pairings_code_hash_unique` ON `bridge_pairings` (`code_hash`);--> statement-breakpoint
ALTER TABLE `bridge` ADD `agent_id` text;