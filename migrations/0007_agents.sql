CREATE TABLE `agent_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`hash` text NOT NULL,
	`prefix` text NOT NULL,
	`scopes` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_tokens_hash_unique` ON `agent_tokens` (`hash`);--> statement-breakpoint
CREATE INDEX `agent_tokens_agent_idx` ON `agent_tokens` (`agent_id`);--> statement-breakpoint
CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `agents_owner_idx` ON `agents` (`owner_id`);--> statement-breakpoint
ALTER TABLE `attempts` ADD `created_via` text;--> statement-breakpoint
ALTER TABLE `attempts` ADD `finished_via` text;--> statement-breakpoint
ALTER TABLE `items` ADD `created_via` text;