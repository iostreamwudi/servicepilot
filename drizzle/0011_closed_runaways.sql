ALTER TABLE `evaluation_results` ADD `trace_id` text;--> statement-breakpoint
ALTER TABLE `evaluation_results` ADD `prompt_tokens` integer;--> statement-breakpoint
ALTER TABLE `evaluation_results` ADD `completion_tokens` integer;--> statement-breakpoint
ALTER TABLE `evaluation_results` ADD `total_tokens` integer;