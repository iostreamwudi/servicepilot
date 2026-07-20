ALTER TABLE `evaluation_results` ADD `source_dataset` text DEFAULT 'ServicePilot synthetic seed' NOT NULL;--> statement-breakpoint
ALTER TABLE `evaluation_results` ADD `source_record_id` text;--> statement-breakpoint
ALTER TABLE `evaluation_results` ADD `context_required` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `evaluation_results` ADD `history_json` text DEFAULT '[]' NOT NULL;