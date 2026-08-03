-- Tracks the highest AI-spend alert step already emailed for a business, so the operator alert
-- fires once per crossing instead of on every job run. Defaults to 0 (no alert sent).
ALTER TABLE "Business" ADD COLUMN "aiCostAlertStepSent" INTEGER NOT NULL DEFAULT 0;
