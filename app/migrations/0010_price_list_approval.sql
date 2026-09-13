-- Commercial rates require explicit four-eye approval before agreement generation.

ALTER TABLE acquiring_price_list ADD COLUMN status TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE acquiring_price_list ADD COLUMN created_by TEXT;
ALTER TABLE acquiring_price_list ADD COLUMN approved_by TEXT;
ALTER TABLE acquiring_price_list ADD COLUMN approved_at_ms INTEGER;
ALTER TABLE acquiring_price_list ADD COLUMN source_note TEXT;

CREATE INDEX idx_acquiring_price_list_status
  ON acquiring_price_list (kind, status, version DESC);
