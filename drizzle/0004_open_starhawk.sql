CREATE TABLE `evaluation_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`evaluation_result_id` text NOT NULL,
	`reviewer_email` text NOT NULL,
	`decision` text NOT NULL,
	`corrected_source` text,
	`corrected_handoff` integer,
	`note` text DEFAULT '' NOT NULL,
	`reviewed_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`evaluation_result_id`) REFERENCES `evaluation_results`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `evaluation_reviews_evaluation_result_id_unique` ON `evaluation_reviews` (`evaluation_result_id`);