CREATE TABLE `evaluation_results` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`case_id` text NOT NULL,
	`category` text NOT NULL,
	`query` text NOT NULL,
	`passed` integer NOT NULL,
	`expected_source` text,
	`actual_source` text,
	`expected_handoff` integer NOT NULL,
	`actual_handoff` integer NOT NULL,
	`latency_ms` integer NOT NULL,
	`mode` text NOT NULL,
	`failures_json` text DEFAULT '[]' NOT NULL,
	`answer` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `evaluation_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `evaluation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`model` text NOT NULL,
	`dataset_version` text NOT NULL,
	`status` text NOT NULL,
	`total_cases` integer NOT NULL,
	`passed_cases` integer DEFAULT 0 NOT NULL,
	`pass_rate` real DEFAULT 0 NOT NULL,
	`high_risk_pass_rate` real DEFAULT 0 NOT NULL,
	`average_latency_ms` real DEFAULT 0 NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
