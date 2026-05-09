/*
  Warnings:

  - You are about to drop the `RequirementCandidate` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED', 'EXPIRED');

-- DropForeignKey
ALTER TABLE "RequirementCandidate" DROP CONSTRAINT "RequirementCandidate_assignmentId_fkey";

-- DropForeignKey
ALTER TABLE "RequirementCandidate" DROP CONSTRAINT "RequirementCandidate_requirementId_fkey";

-- DropTable
DROP TABLE "RequirementCandidate";

-- DropEnum
DROP TYPE "CandidateStageStatus";

-- CreateTable
CREATE TABLE "PipelineStage" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "serviceLineId" TEXT,
    "isMandatory" BOOLEAN NOT NULL DEFAULT true,
    "isTerminal" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PipelineStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidateSnapshot" (
    "id" TEXT NOT NULL,
    "candidateServiceId" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "snapshotAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "currentTitle" TEXT,
    "currentCompany" TEXT,
    "totalExpYears" DOUBLE PRECISION,
    "topSkills" TEXT[],
    "resumeUrl" TEXT,
    "rawSnapshot" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CandidateSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequirementCandidatePipeline" (
    "id" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "recruiterId" TEXT NOT NULL,
    "currentStageId" TEXT NOT NULL,
    "stageUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stageUpdatedById" TEXT NOT NULL,
    "submissionNote" TEXT,
    "submittedAt" TIMESTAMP(3),
    "submittedById" TEXT,
    "offeredCtc" DOUBLE PRECISION,
    "salaryCurrency" TEXT DEFAULT 'INR',
    "salaryType" "SalaryType",
    "offeredAt" TIMESTAMP(3),
    "offeredById" TEXT,
    "offerStatus" "OfferStatus",
    "expectedJoiningDate" TIMESTAMP(3),
    "actualJoiningDate" TIMESTAMP(3),
    "isRejected" BOOLEAN NOT NULL DEFAULT false,
    "rejectedAt" TIMESTAMP(3),
    "rejectedById" TEXT,
    "rejectionReason" TEXT,
    "isWithdrawn" BOOLEAN NOT NULL DEFAULT false,
    "withdrawnAt" TIMESTAMP(3),
    "withdrawnReason" TEXT,
    "isOnHold" BOOLEAN NOT NULL DEFAULT false,
    "onHoldAt" TIMESTAMP(3),
    "onHoldReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RequirementCandidatePipeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CandidatePipelineStageLog" (
    "id" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "fromStageId" TEXT,
    "toStageId" TEXT NOT NULL,
    "changedById" TEXT NOT NULL,
    "wasSkipped" BOOLEAN NOT NULL DEFAULT false,
    "skipReason" TEXT,
    "timeInPrevStageMins" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CandidatePipelineStageLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PipelineStage_code_key" ON "PipelineStage"("code");

-- CreateIndex
CREATE INDEX "PipelineStage_order_idx" ON "PipelineStage"("order");

-- CreateIndex
CREATE INDEX "PipelineStage_serviceLineId_idx" ON "PipelineStage"("serviceLineId");

-- CreateIndex
CREATE INDEX "CandidateSnapshot_requirementId_idx" ON "CandidateSnapshot"("requirementId");

-- CreateIndex
CREATE INDEX "CandidateSnapshot_candidateServiceId_idx" ON "CandidateSnapshot"("candidateServiceId");

-- CreateIndex
CREATE UNIQUE INDEX "CandidateSnapshot_candidateServiceId_requirementId_key" ON "CandidateSnapshot"("candidateServiceId", "requirementId");

-- CreateIndex
CREATE UNIQUE INDEX "RequirementCandidatePipeline_snapshotId_key" ON "RequirementCandidatePipeline"("snapshotId");

-- CreateIndex
CREATE INDEX "RequirementCandidatePipeline_requirementId_currentStageId_idx" ON "RequirementCandidatePipeline"("requirementId", "currentStageId");

-- CreateIndex
CREATE INDEX "RequirementCandidatePipeline_recruiterId_idx" ON "RequirementCandidatePipeline"("recruiterId");

-- CreateIndex
CREATE INDEX "RequirementCandidatePipeline_assignmentId_idx" ON "RequirementCandidatePipeline"("assignmentId");

-- CreateIndex
CREATE INDEX "RequirementCandidatePipeline_stageUpdatedAt_idx" ON "RequirementCandidatePipeline"("stageUpdatedAt");

-- CreateIndex
CREATE INDEX "CandidatePipelineStageLog_pipelineId_createdAt_idx" ON "CandidatePipelineStageLog"("pipelineId", "createdAt");

-- CreateIndex
CREATE INDEX "CandidatePipelineStageLog_toStageId_idx" ON "CandidatePipelineStageLog"("toStageId");

-- AddForeignKey
ALTER TABLE "PipelineStage" ADD CONSTRAINT "PipelineStage_serviceLineId_fkey" FOREIGN KEY ("serviceLineId") REFERENCES "ServiceLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateSnapshot" ADD CONSTRAINT "CandidateSnapshot_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateSnapshot" ADD CONSTRAINT "CandidateSnapshot_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementCandidatePipeline" ADD CONSTRAINT "RequirementCandidatePipeline_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "CandidateSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementCandidatePipeline" ADD CONSTRAINT "RequirementCandidatePipeline_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementCandidatePipeline" ADD CONSTRAINT "RequirementCandidatePipeline_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "RequirementAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementCandidatePipeline" ADD CONSTRAINT "RequirementCandidatePipeline_recruiterId_fkey" FOREIGN KEY ("recruiterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementCandidatePipeline" ADD CONSTRAINT "RequirementCandidatePipeline_currentStageId_fkey" FOREIGN KEY ("currentStageId") REFERENCES "PipelineStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementCandidatePipeline" ADD CONSTRAINT "RequirementCandidatePipeline_stageUpdatedById_fkey" FOREIGN KEY ("stageUpdatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementCandidatePipeline" ADD CONSTRAINT "RequirementCandidatePipeline_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementCandidatePipeline" ADD CONSTRAINT "RequirementCandidatePipeline_offeredById_fkey" FOREIGN KEY ("offeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementCandidatePipeline" ADD CONSTRAINT "RequirementCandidatePipeline_rejectedById_fkey" FOREIGN KEY ("rejectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidatePipelineStageLog" ADD CONSTRAINT "CandidatePipelineStageLog_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "RequirementCandidatePipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidatePipelineStageLog" ADD CONSTRAINT "CandidatePipelineStageLog_fromStageId_fkey" FOREIGN KEY ("fromStageId") REFERENCES "PipelineStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidatePipelineStageLog" ADD CONSTRAINT "CandidatePipelineStageLog_toStageId_fkey" FOREIGN KEY ("toStageId") REFERENCES "PipelineStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidatePipelineStageLog" ADD CONSTRAINT "CandidatePipelineStageLog_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
