ALTER TABLE `attempts` ADD `finished_by` text REFERENCES users(id);--> statement-breakpoint
UPDATE `attempts` SET `finished_by` = `created_by` WHERE `outcome` IS NOT NULL;
