ALTER TABLE `evaluation_results` ADD `routing_intent` text;--> statement-breakpoint
ALTER TABLE `evaluation_results` ADD `routing_confidence` real;--> statement-breakpoint
ALTER TABLE `evaluation_results` ADD `routing_signals_json` text DEFAULT '[]' NOT NULL;