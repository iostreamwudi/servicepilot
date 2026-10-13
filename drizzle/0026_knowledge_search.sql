CREATE VIRTUAL TABLE `knowledge_fts` USING fts5(
  `document_id` UNINDEXED,
  `organization_id` UNINDEXED,
  `title`,
  `content`,
  `category` UNINDEXED,
  `owner_team`,
  `source_title`
);
INSERT INTO `knowledge_fts` (`document_id`, `organization_id`, `title`, `content`, `category`, `owner_team`, `source_title`)
SELECT `id`, `organization_id`, `title`, `content`, `category`, `owner_team`, COALESCE(`source_title`, '')
FROM `knowledge_documents`;
