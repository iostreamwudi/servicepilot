CREATE TABLE `agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`trace_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`conversation_id` text,
	`model` text,
	`query` text NOT NULL,
	`intent` text,
	`routing_confidence` real,
	`knowledge_json` text DEFAULT '[]' NOT NULL,
	`tool_calls_json` text DEFAULT '[]' NOT NULL,
	`trace_json` text DEFAULT '[]' NOT NULL,
	`answer` text,
	`handoff` integer DEFAULT false NOT NULL,
	`mode` text NOT NULL,
	`status` text NOT NULL,
	`failure_code` text,
	`prompt_tokens` integer,
	`completion_tokens` integer,
	`total_tokens` integer,
	`latency_ms` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_runs_trace_id_unique` ON `agent_runs` (`trace_id`);--> statement-breakpoint
