-- CreateEnum
CREATE TYPE "InterviewMode" AS ENUM ('ONLINE', 'OFFLINE', 'TELEPHONIC');

-- AlterEnum
ALTER TYPE "NotificationReferenceType" ADD VALUE 'PIPELINE';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'INTERVIEW_SCHEDULED';

-- CreateTable
CREATE TABLE "CandidateInterviewSchedule" (
    "id" TEXT NOT NULL,
    "pipelineId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "roundNumber" INTEGER NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "durationMins" INTEGER NOT NULL,
    "mode" "InterviewMode" NOT NULL,
    "status" "CanonicalStage" NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateInterviewSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CandidateInterviewSchedule_pipelineId_idx" ON "CandidateInterviewSchedule"("pipelineId");

-- CreateIndex
CREATE INDEX "CandidateInterviewSchedule_stageId_idx" ON "CandidateInterviewSchedule"("stageId");

-- CreateIndex
CREATE INDEX "CandidateInterviewSchedule_scheduledAt_idx" ON "CandidateInterviewSchedule"("scheduledAt");

-- AddForeignKey
ALTER TABLE "CandidateInterviewSchedule" ADD CONSTRAINT "CandidateInterviewSchedule_pipelineId_fkey" FOREIGN KEY ("pipelineId") REFERENCES "RequirementCandidatePipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateInterviewSchedule" ADD CONSTRAINT "CandidateInterviewSchedule_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "PipelineStage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CandidateInterviewSchedule" ADD CONSTRAINT "CandidateInterviewSchedule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
