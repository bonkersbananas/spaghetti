CREATE TABLE `link_previews` (
	`url` text PRIMARY KEY NOT NULL,
	`title` text,
	`site` text,
	`failed` integer DEFAULT false NOT NULL,
	`fetched_at` integer NOT NULL
);
