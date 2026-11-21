CREATE TABLE `shares` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`target_id` text NOT NULL,
	`token` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shares_token_hash_unique` ON `shares` (`token_hash`);--> statement-breakpoint
CREATE INDEX `shares_target_idx` ON `shares` (`kind`,`target_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `shares_live_target_idx` ON `shares` (`kind`,`target_id`) WHERE "shares"."revoked_at" is null;