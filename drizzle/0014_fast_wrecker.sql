CREATE TABLE `retrieval_shadow_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`shadow_run_id` text NOT NULL,
	`reviewer_email` text NOT NULL,
	`decision` text NOT NULL,
	`corrected_source_id` text,
	`note` text DEFAULT '' NOT NULL,
	`reviewed_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`shadow_run_id`) REFERENCES `retrieval_shadow_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `retrieval_shadow_reviews_shadow_run_id_unique` ON `retrieval_shadow_reviews` (`shadow_run_id`);