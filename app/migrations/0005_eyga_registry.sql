-- Public company facts imported from eyga.fo.
--
-- A snapshot records exactly what the merchant confirmed. It contains only public
-- registry data (company facts, named owners and management), never P-tal or private
-- addresses. V-tal remains a merchant-provided TAKS identifier because it is not the
-- same as Skráseting Føroya's registration number.

ALTER TABLE onboarding_application ADD COLUMN company_type TEXT;
ALTER TABLE onboarding_application ADD COLUMN registry_source TEXT;
ALTER TABLE onboarding_application ADD COLUMN registry_id TEXT;
ALTER TABLE onboarding_application ADD COLUMN registry_status TEXT;
ALTER TABLE onboarding_application ADD COLUMN registry_checked_at_ms INTEGER;
ALTER TABLE onboarding_application ADD COLUMN registry_snapshot TEXT;
ALTER TABLE onboarding_application ADD COLUMN company_details_confirmed INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_onboarding_registry_id
  ON onboarding_application (registry_source, registry_id);
