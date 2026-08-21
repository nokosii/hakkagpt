CREATE TABLE `knowledge_governance` (
	`record_id` text PRIMARY KEY NOT NULL,
	`record_kind` text NOT NULL,
	`dialect` text DEFAULT '未標示' NOT NULL,
	`rights_holder` text DEFAULT '未標示' NOT NULL,
	`rights_basis` text DEFAULT '待確認' NOT NULL,
	`license` text DEFAULT '未標示' NOT NULL,
	`access_level` text DEFAULT 'public' NOT NULL,
	`community_benefit` text DEFAULT '客家知識保存、教育與研究' NOT NULL,
	`consent_confirmed` integer DEFAULT false NOT NULL,
	`review_gates` text DEFAULT '{}' NOT NULL,
	`reviewer_email` text,
	`review_note` text,
	`reviewed_at` integer,
	`withdrawn_at` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_governance_kind_access_dialect` ON `knowledge_governance` (`record_kind`,`access_level`,`dialect`);