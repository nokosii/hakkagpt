CREATE TABLE `knowledge_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`document_id` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`document_id`) REFERENCES `knowledge_documents`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_chunks_document_index` ON `knowledge_chunks` (`document_id`,`chunk_index`);--> statement-breakpoint
CREATE TABLE `knowledge_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`file_name` text NOT NULL,
	`file_type` text NOT NULL,
	`object_key` text NOT NULL,
	`byte_size` integer NOT NULL,
	`page_count` integer,
	`row_count` integer,
	`chunk_count` integer NOT NULL,
	`status` text DEFAULT 'ready' NOT NULL,
	`owner_id` text NOT NULL,
	`owner_email` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_documents_created` ON `knowledge_documents` (`created_at`);--> statement-breakpoint
CREATE TABLE `knowledge_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`term` text NOT NULL,
	`slug` text NOT NULL,
	`summary` text NOT NULL,
	`content` text NOT NULL,
	`source_url` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`author_id` text NOT NULL,
	`author_email` text NOT NULL,
	`reviewer_email` text,
	`review_note` text,
	`created_at` integer NOT NULL,
	`reviewed_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_revisions_slug_status_created` ON `knowledge_revisions` (`slug`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_revisions_status_created` ON `knowledge_revisions` (`status`,`created_at`);