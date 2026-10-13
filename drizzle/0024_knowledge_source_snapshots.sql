CREATE TABLE `knowledge_source_snapshots` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL REFERENCES `organizations`(`id`),
  `document_id` text NOT NULL REFERENCES `knowledge_documents`(`id`),
  `version_id` text,
  `source_type` text NOT NULL,
  `source_title` text,
  `source_url` text,
  `source_version` text NOT NULL DEFAULT 'unknown',
  `content_hash` text NOT NULL DEFAULT '',
  `snapshot_content` text NOT NULL,
  `sync_status` text NOT NULL DEFAULT 'captured',
  `fetched_at` text NOT NULL,
  `created_by_user_id` text REFERENCES `users`(`id`),
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX `knowledge_source_snapshots_document_idx` ON `knowledge_source_snapshots` (`organization_id`, `document_id`, `created_at`);
INSERT INTO `knowledge_source_snapshots` (`id`, `organization_id`, `document_id`, `version_id`, `source_type`, `source_title`, `source_url`, `source_version`, `content_hash`, `snapshot_content`, `sync_status`, `fetched_at`, `created_at`)
SELECT 'SOURCE-' || `id`, `organization_id`, `id`, NULL, `source_type`, `source_title`, `source_url`, `version`, '', `content`, 'captured', `updated_at`, CURRENT_TIMESTAMP
FROM `knowledge_documents`;
