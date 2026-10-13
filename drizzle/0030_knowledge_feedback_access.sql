CREATE TABLE `knowledge_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL REFERENCES organizations(id),
	`knowledge_id` text NOT NULL REFERENCES knowledge_documents(id),
	`actor_user_id` text NOT NULL REFERENCES users(id),
	`reason` text NOT NULL,
	`content` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`resolution_note` text DEFAULT '' NOT NULL,
	`resolved_by_user_id` text REFERENCES users(id),
	`resolved_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE `knowledge_access_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL REFERENCES organizations(id),
	`requester_user_id` text NOT NULL REFERENCES users(id),
	`requested_role` text NOT NULL,
	`feature` text NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`reviewer_user_id` text REFERENCES users(id),
	`review_note` text DEFAULT '' NOT NULL,
	`reviewed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
