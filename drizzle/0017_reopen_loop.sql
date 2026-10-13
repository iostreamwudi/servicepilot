ALTER TABLE `conversations` ADD `reopen_count` integer NOT NULL DEFAULT 0;
ALTER TABLE `conversations` ADD `last_reopened_at` text;
ALTER TABLE `conversations` ADD `last_reopened_by_email` text;
ALTER TABLE `conversations` ADD `last_reopen_reason` text;
