ALTER TABLE `tickets` ADD `create_request_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `tickets_create_request_id_unique` ON `tickets` (`create_request_id`);