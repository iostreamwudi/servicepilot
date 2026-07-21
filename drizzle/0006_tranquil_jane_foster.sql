CREATE TABLE `agent_conversation_states` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`active_intent` text,
	`summary` text DEFAULT '' NOT NULL,
	`last_user_message` text DEFAULT '' NOT NULL,
	`turn_count` integer DEFAULT 0 NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_conversation_states_conversation_id_unique` ON `agent_conversation_states` (`conversation_id`);