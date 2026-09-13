-- Official FO templates are used under the commercial Swedbank Pay + ePay
-- agreement. Fill still hash-pins the exact binaries and overlays the static
-- page-5 country note to FO. Signing still requires an approved price list.

ALTER TABLE document_template ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE document_template ADD COLUMN approved_by TEXT;
ALTER TABLE document_template ADD COLUMN approved_at_ms INTEGER;
ALTER TABLE document_template ADD COLUMN approval_note TEXT;

UPDATE document_template
SET active = 1,
    approval_status = 'approved',
    approved_by = 'hey@betal.fo',
    approved_at_ms = 1789301040000,
    approval_note = 'Commercial FO agreement with Swedbank Pay and ePay. Official Oneflow 12465631 binary; page-5 country note is overlaid to FO at fill time.'
WHERE id = 'swedbank-online-fo-12465631-v1';

UPDATE document_template
SET approval_status = 'approved',
    approved_by = 'nicolai.christiansen@swedbankpay.com',
    approved_at_ms = 1765186860000,
    approval_note = 'Attached by Swedbank as the required Faroese bank-confirmation and prohibited-lines forms.'
WHERE id IN (
  'swedbank-bank-confirmation-v1',
  'swedbank-prohibited-lines-v1'
);
