import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const knowledgeRevisions = sqliteTable(
  "knowledge_revisions",
  {
    id: text("id").primaryKey(),
    term: text("term").notNull(),
    slug: text("slug").notNull(),
    summary: text("summary").notNull(),
    content: text("content").notNull(),
    sourceUrl: text("source_url"),
    status: text("status", { enum: ["pending", "approved", "rejected"] })
      .notNull()
      .default("pending"),
    authorId: text("author_id").notNull(),
    authorEmail: text("author_email").notNull(),
    reviewerEmail: text("reviewer_email"),
    reviewNote: text("review_note"),
    createdAt: integer("created_at").notNull(),
    reviewedAt: integer("reviewed_at"),
  },
  (table) => [
    index("idx_revisions_slug_status_created").on(
      table.slug,
      table.status,
      table.createdAt,
    ),
    index("idx_revisions_status_created").on(table.status, table.createdAt),
  ],
);

export const knowledgeDocuments = sqliteTable(
  "knowledge_documents",
  {
    id: text("id").primaryKey(),
    fileName: text("file_name").notNull(),
    fileType: text("file_type", { enum: ["csv", "pdf"] }).notNull(),
    objectKey: text("object_key").notNull(),
    byteSize: integer("byte_size").notNull(),
    pageCount: integer("page_count"),
    rowCount: integer("row_count"),
    chunkCount: integer("chunk_count").notNull(),
    status: text("status").notNull().default("ready"),
    ownerId: text("owner_id").notNull(),
    ownerEmail: text("owner_email").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("idx_documents_created").on(table.createdAt)],
);

export const knowledgeChunks = sqliteTable(
  "knowledge_chunks",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      .references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("idx_chunks_document_index").on(table.documentId, table.chunkIndex),
  ],
);
