CREATE TABLE `knowledge_conflicts` (
  `id` text PRIMARY KEY NOT NULL,
  `organization_id` text NOT NULL REFERENCES `organizations`(`id`),
  `document_id` text NOT NULL REFERENCES `knowledge_documents`(`id`),
  `conflicting_document_id` text NOT NULL REFERENCES `knowledge_documents`(`id`),
  `kind` text NOT NULL,
  `severity` text NOT NULL,
  `status` text NOT NULL DEFAULT 'open',
  `title` text NOT NULL,
  `reason` text NOT NULL,
  `scope` text NOT NULL DEFAULT '同服务域',
  `owner_user_id` text REFERENCES `users`(`id`),
  `resolution_note` text NOT NULL DEFAULT '',
  `resolved_by_user_id` text REFERENCES `users`(`id`),
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `resolved_at` text
);
CREATE INDEX `knowledge_conflicts_document_idx` ON `knowledge_conflicts` (`organization_id`, `document_id`, `status`, `created_at`);
