-- AlterTable
ALTER TABLE "RequirementCandidatePipeline" ADD COLUMN     "ctcNotes" TEXT,
ADD COLUMN     "currentCtc" DOUBLE PRECISION,
ADD COLUMN     "expectedCtc" DOUBLE PRECISION,
ADD COLUMN     "lastWorkingDate" TIMESTAMP(3),
ADD COLUMN     "monthOfJoining" TEXT,
ADD COLUMN     "negotiatedCtc" DOUBLE PRECISION,
ADD COLUMN     "remainingDaysToJoin" INTEGER;

-- CreateIndex
CREATE INDEX "RequirementCandidatePipeline_actualJoiningDate_idx" ON "RequirementCandidatePipeline"("actualJoiningDate");

-- CreateIndex
CREATE INDEX "RequirementCandidatePipeline_expectedJoiningDate_idx" ON "RequirementCandidatePipeline"("expectedJoiningDate");

-- CreateIndex
CREATE INDEX "RequirementCandidatePipeline_monthOfJoining_idx" ON "RequirementCandidatePipeline"("monthOfJoining");

-- CreateIndex
CREATE INDEX "RequirementCandidatePipeline_disposition_idx" ON "RequirementCandidatePipeline"("disposition");
