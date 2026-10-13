CREATE TABLE `knowledge_saved_views` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL REFERENCES organizations(id),
	`owner_user_id` text NOT NULL REFERENCES users(id),
	`name` text NOT NULL,
	`scope` text DEFAULT 'personal' NOT NULL,
	`team_key` text,
	`state_filter` text DEFAULT 'all' NOT NULL,
	`category_filter` text DEFAULT 'all' NOT NULL,
	`sort` text DEFAULT 'updated' NOT NULL,
	`query` text DEFAULT '' NOT NULL,
	`owner_filter` text DEFAULT '' NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
