-- AlterTable
ALTER TABLE "PipelineStage" ADD COLUMN     "isStandard" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "RequirementCandidatePipeline" ADD COLUMN     "noticePeriod" TEXT;
