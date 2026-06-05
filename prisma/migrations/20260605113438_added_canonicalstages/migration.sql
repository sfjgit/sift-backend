-- CreateEnum
CREATE TYPE "CanonicalStage" AS ENUM ('SOURCED', 'SCREENING', 'INTERVIEW', 'OFFER', 'JOINED', 'DROPPED');

-- AlterTable
ALTER TABLE "CandidatePipelineStageLog" ADD COLUMN     "fromCanonicalStage" "CanonicalStage",
ADD COLUMN     "toCanonicalStage" "CanonicalStage";

-- AlterTable
ALTER TABLE "PipelineStage" ADD COLUMN     "canonicalStage" "CanonicalStage";

-- AlterTable
ALTER TABLE "RequirementCandidatePipeline" ADD COLUMN     "currentCanonicalStage" "CanonicalStage";

-- CreateIndex
CREATE INDEX "CandidatePipelineStageLog_toCanonicalStage_idx" ON "CandidatePipelineStageLog"("toCanonicalStage");

-- CreateIndex
CREATE INDEX "PipelineStage_canonicalStage_idx" ON "PipelineStage"("canonicalStage");

-- CreateIndex
CREATE INDEX "RequirementCandidatePipeline_requirementId_currentCanonical_idx" ON "RequirementCandidatePipeline"("requirementId", "currentCanonicalStage");
