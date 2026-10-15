-- Never both: a pipeline row has LWD OR notice period days, not both
ALTER TABLE "RequirementCandidatePipeline"
  ADD CONSTRAINT "pipeline_lwd_xor_notice_period"
  CHECK (NOT ("lastWorkingDate" IS NOT NULL AND "noticePeriodDays" IS NOT NULL));

-- Notice period must be a sane number of days
ALTER TABLE "RequirementCandidatePipeline"
  ADD CONSTRAINT "pipeline_notice_period_days_range"
  CHECK ("noticePeriodDays" IS NULL OR ("noticePeriodDays" >= 0 AND "noticePeriodDays" <= 365));