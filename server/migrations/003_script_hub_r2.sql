-- Script Hub：revision 正文 R2 指针列（与 server/script-hub-store.js DDL 对齐）

ALTER TABLE script_hub_revisions
  ADD COLUMN IF NOT EXISTS content_storage_key TEXT NOT NULL DEFAULT '';
