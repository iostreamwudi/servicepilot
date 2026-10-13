CREATE TABLE `knowledge_embeddings` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`document_id` text NOT NULL,
	`model` text NOT NULL,
	`dimensions` integer NOT NULL,
	`vector_json` text NOT NULL,
	`content_hash` text NOT NULL,
	`document_version` text NOT NULL,
	`index_version` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`document_id`) REFERENCES `knowledge_documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `retrieval_shadow_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`trace_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`intent` text,
	`current_source_id` text,
	`candidate_source_id` text,
	`changed` integer DEFAULT false NOT NULL,
	`status` text NOT NULL,
	`embedding_model` text,
	`index_version` text,
	`candidates_json` text DEFAULT '[]' NOT NULL,
	`selection_reason` text,
	`latency_ms` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `retrieval_shadow_runs_trace_id_unique` ON `retrieval_shadow_runs` (`trace_id`);