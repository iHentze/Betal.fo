-- R2 object keys stay ASCII-only. This avoids CLI/transport normalization differences
-- for the Danish bank-confirmation filename while preserving the original source name.

UPDATE document_template
SET r2_key = CASE id
  WHEN 'swedbank-online-fo-12465631-v1'
    THEN 'templates/swedbank/agreement-online-fo-v1.pdf'
  WHEN 'swedbank-bank-confirmation-v1'
    THEN 'templates/swedbank/bank-confirmation-v1.pdf'
  WHEN 'swedbank-prohibited-lines-v1'
    THEN 'templates/swedbank/prohibited-lines-v1.pdf'
  ELSE r2_key
END
WHERE id IN (
  'swedbank-online-fo-12465631-v1',
  'swedbank-bank-confirmation-v1',
  'swedbank-prohibited-lines-v1'
);
