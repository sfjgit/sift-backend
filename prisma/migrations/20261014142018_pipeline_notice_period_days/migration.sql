-- AlterTable
ALTER TABLE "RequirementCandidatePipeline" ADD COLUMN     "noticePeriodDays" INTEGER;

-- CreateIndex
CREATE INDEX "RequirementCandidatePipeline_lastWorkingDate_idx" ON "RequirementCandidatePipeline"("lastWorkingDate");

-- CreateIndex
CREATE INDEX "RequirementCandidatePipeline_noticePeriodDays_idx" ON "RequirementCandidatePipeline"("noticePeriodDays");
