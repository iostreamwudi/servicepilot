CREATE TABLE `embedding_index_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`model` text NOT NULL,
	`current_index_version` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT OR REPLACE INTO `embedding_index_versions` (`id`, `organization_id`, `model`, `current_index_version`)
SELECT `organization_id` || ':' || `model`, `organization_id`, `model`, MAX(`index_version`)
FROM `knowledge_embeddings`
WHERE `active` = 1
GROUP BY `organization_id`, `model`;
