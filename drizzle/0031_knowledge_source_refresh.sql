CREATE TABLE `knowledge_source_refresh_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL REFERENCES `organizations`(`id`),
	`knowledge_id` text NOT NULL REFERENCES `knowledge_documents`(`id`),
	`requested_by_user_id` text NOT NULL REFERENCES `users`(`id`),
	`owner_user_id` text REFERENCES `users`(`id`),
	`reason` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
