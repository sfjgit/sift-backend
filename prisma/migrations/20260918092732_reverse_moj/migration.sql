-- AlterTable
ALTER TABLE "RequirementCandidatePipeline" ADD COLUMN     "actualJoiningDate" TIMESTAMP(3),
ADD COLUMN     "expectedJoiningDate" TIMESTAMP(3),
ADD COLUMN     "remainingDaysToJoin" INTEGER;
