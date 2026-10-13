ALTER TABLE `knowledge_documents` ADD `owner_user_id` text REFERENCES users(id);
