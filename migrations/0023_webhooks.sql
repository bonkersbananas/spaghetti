CREATE TABLE `webhook_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`webhook_id` text NOT NULL,
	`seq` integer,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`http_status` integer,
	`error` text,
	`next_at` integer,
	`last_attempt_at` integer,
	`created_at` integer NOT NULL,
	`give_up_at` integer NOT NULL,
	FOREIGN KEY (`webhook_id`) REFERENCES `webhooks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `webhook_deliveries_due_idx` ON `webhook_deliveries` (`status`,`next_at`);--> statement-breakpoint
CREATE INDEX `webhook_deliveries_webhook_idx` ON `webhook_deliveries` (`webhook_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `webhook_deliveries_seq_idx` ON `webhook_deliveries` (`webhook_id`,`seq`);--> statement-breakpoint
CREATE TABLE `webhooks` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`url` text NOT NULL,
	`kinds` text NOT NULL,
	`agent_id` text,
	`secret_enc` text NOT NULL,
	`secret_prefix` text NOT NULL,
	`state` text DEFAULT 'active' NOT NULL,
	`last_error` text,
	`last_error_at` integer,
	`last_delivered_at` integer,
	`cursor` integer NOT NULL,
	`created_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `webhooks_owner_idx` ON `webhooks` (`owner_id`);