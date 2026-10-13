CREATE TABLE `knowledge_versions` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL REFERENCES `organizations`(`id`),
  `document_id` text NOT NULL REFERENCES `knowledge_documents`(`id`),
  `version` text NOT NULL,
  `title` text NOT NULL,
  `owner_team` text NOT NULL,
  `content` text NOT NULL,
  `category` text NOT NULL,
  `keywords_json` text DEFAULT '[]' NOT NULL,
  `risk` text NOT NULL,
  `handoff` integer DEFAULT 0 NOT NULL,
  `source_type` text NOT NULL,
  `source_title` text,
  `source_url` text,
  `state` text NOT NULL,
  `coverage` real DEFAULT 0 NOT NULL,
  `valid_from` text,
  `valid_until` text,
  `created_by_user_id` text REFERENCES `users`(`id`),
  `published_by_user_id` text REFERENCES `users`(`id`),
  `release_percent` integer DEFAULT 0 NOT NULL,
  `change_summary` text DEFAULT '' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `published_at` text
);
CREATE INDEX `knowledge_versions_document_idx` ON `knowledge_versions` (`document_id`, `created_at`);
CREATE INDEX `knowledge_versions_organization_idx` ON `knowledge_versions` (`organization_id`, `state`);
