ALTER TABLE `knowledge_documents` ADD `category` text DEFAULT 'refund' NOT NULL;--> statement-breakpoint
ALTER TABLE `knowledge_documents` ADD `keywords_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `knowledge_documents` ADD `risk` text DEFAULT 'medium' NOT NULL;--> statement-breakpoint
ALTER TABLE `knowledge_documents` ADD `handoff` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `knowledge_documents` ADD `source_type` text DEFAULT 'internal_demo' NOT NULL;--> statement-breakpoint
ALTER TABLE `knowledge_documents` ADD `source_title` text;--> statement-breakpoint
ALTER TABLE `knowledge_documents` ADD `source_url` text;