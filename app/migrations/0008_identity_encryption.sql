-- Store Samleikin-verified P-tal encrypted at application level. The legacy p_tal
-- column remains for migration compatibility and is always cleared by current code.

ALTER TABLE onboarding_signing ADD COLUMN p_tal_ciphertext TEXT;
ALTER TABLE onboarding_signing ADD COLUMN p_tal_last4 TEXT;
