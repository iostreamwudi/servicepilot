CREATE TABLE `customer_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`customer_name` text NOT NULL,
	`tier` text,
	`order_count` integer DEFAULT 0 NOT NULL,
	`lifetime_value` real DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`customer_name` text NOT NULL,
	`status` text NOT NULL,
	`total_amount` real NOT NULL,
	`payment_channel_masked` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `refunds` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`order_id` text NOT NULL,
	`status` text NOT NULL,
	`approved_at` text,
	`expected_business_days` text,
	`amount` real,
	`source_type` text DEFAULT 'production' NOT NULL,
	`source_id` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `shipments` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`order_id` text NOT NULL,
	`status` text NOT NULL,
	`carrier` text,
	`tracking_number_masked` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `conversations` ADD `trace_id` text;--> statement-breakpoint
ALTER TABLE `conversations` ADD `source_type` text DEFAULT 'production' NOT NULL;--> statement-breakpoint
ALTER TABLE `conversations` ADD `source_id` text;--> statement-breakpoint
ALTER TABLE `conversations` ADD `is_synthetic` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `trace_id` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `source_type` text DEFAULT 'production' NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `source_id` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `is_synthetic` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `messages` ADD `failure_code` text;--> statement-breakpoint
ALTER TABLE `tickets` ADD `trigger_reason` text;--> statement-breakpoint
ALTER TABLE `tickets` ADD `summary` text;--> statement-breakpoint
ALTER TABLE `tickets` ADD `source_type` text DEFAULT 'production' NOT NULL;--> statement-breakpoint
ALTER TABLE `tickets` ADD `source_id` text;--> statement-breakpoint
ALTER TABLE `tickets` ADD `trace_id` text;--> statement-breakpoint
ALTER TABLE `tickets` ADD `is_synthetic` integer DEFAULT false NOT NULL;