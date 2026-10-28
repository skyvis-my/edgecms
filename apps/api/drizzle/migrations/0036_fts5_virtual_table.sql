-- Standalone FTS5 Virtual Table for BM25 lexical full-text search
CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
  entry_id UNINDEXED,
  tenant_id UNINDEXED,
  collection_id UNINDEXED,
  locale UNINDEXED,
  title,
  body,
  tokenize='porter unicode61 remove_diacritics 2'
);
