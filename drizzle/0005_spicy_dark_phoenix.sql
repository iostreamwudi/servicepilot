ALTER TABLE `evaluation_runs` ADD `suite` text DEFAULT 'regression' NOT NULL;--> statement-breakpoint
ALTER TABLE `evaluation_runs` ADD `system_version` text DEFAULT 'legacy' NOT NULL;