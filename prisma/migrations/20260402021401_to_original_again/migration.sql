/*
  Warnings:

  - The values [CANDIDATE,APPLICATION] on the enum `FlowNodeType` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the `Application` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ApplicationStatusHistory` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Candidate` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `CandidateTag` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `CommunicationLog` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `FileAsset` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Interview` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `InterviewFeedback` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `InterviewPanelMember` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Offer` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `OfferStatusHistory` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Onboarding` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `OnboardingTask` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "FlowNodeType_new" AS ENUM ('BUSINESS_UNIT', 'TEAM', 'USER', 'CLIENT', 'REQUIREMENT');
ALTER TABLE "OrgFlow" ALTER COLUMN "fromType" TYPE "FlowNodeType_new" USING ("fromType"::text::"FlowNodeType_new");
ALTER TABLE "OrgFlow" ALTER COLUMN "toType" TYPE "FlowNodeType_new" USING ("toType"::text::"FlowNodeType_new");
ALTER TYPE "FlowNodeType" RENAME TO "FlowNodeType_old";
ALTER TYPE "FlowNodeType_new" RENAME TO "FlowNodeType";
DROP TYPE "public"."FlowNodeType_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "Application" DROP CONSTRAINT "Application_candidateId_fkey";

-- DropForeignKey
ALTER TABLE "Application" DROP CONSTRAINT "Application_recruiterId_fkey";

-- DropForeignKey
ALTER TABLE "Application" DROP CONSTRAINT "Application_requirementId_fkey";

-- DropForeignKey
ALTER TABLE "ApplicationStatusHistory" DROP CONSTRAINT "ApplicationStatusHistory_applicationId_fkey";

-- DropForeignKey
ALTER TABLE "ApplicationStatusHistory" DROP CONSTRAINT "ApplicationStatusHistory_changedById_fkey";

-- DropForeignKey
ALTER TABLE "Candidate" DROP CONSTRAINT "Candidate_createdById_fkey";

-- DropForeignKey
ALTER TABLE "CandidateTag" DROP CONSTRAINT "CandidateTag_candidateId_fkey";

-- DropForeignKey
ALTER TABLE "CommunicationLog" DROP CONSTRAINT "CommunicationLog_applicationId_fkey";

-- DropForeignKey
ALTER TABLE "CommunicationLog" DROP CONSTRAINT "CommunicationLog_candidateId_fkey";

-- DropForeignKey
ALTER TABLE "CommunicationLog" DROP CONSTRAINT "CommunicationLog_interviewId_fkey";

-- DropForeignKey
ALTER TABLE "CommunicationLog" DROP CONSTRAINT "CommunicationLog_sentById_fkey";

-- DropForeignKey
ALTER TABLE "FileAsset" DROP CONSTRAINT "FileAsset_uploadedById_fkey";

-- DropForeignKey
ALTER TABLE "Interview" DROP CONSTRAINT "Interview_applicationId_fkey";

-- DropForeignKey
ALTER TABLE "Interview" DROP CONSTRAINT "Interview_createdById_fkey";

-- DropForeignKey
ALTER TABLE "Interview" DROP CONSTRAINT "Interview_rescheduledFromId_fkey";

-- DropForeignKey
ALTER TABLE "InterviewFeedback" DROP CONSTRAINT "InterviewFeedback_interviewId_fkey";

-- DropForeignKey
ALTER TABLE "InterviewFeedback" DROP CONSTRAINT "InterviewFeedback_reviewerId_fkey";

-- DropForeignKey
ALTER TABLE "InterviewPanelMember" DROP CONSTRAINT "InterviewPanelMember_interviewId_fkey";

-- DropForeignKey
ALTER TABLE "InterviewPanelMember" DROP CONSTRAINT "InterviewPanelMember_userId_fkey";

-- DropForeignKey
ALTER TABLE "Offer" DROP CONSTRAINT "Offer_applicationId_fkey";

-- DropForeignKey
ALTER TABLE "Offer" DROP CONSTRAINT "Offer_approvedById_fkey";

-- DropForeignKey
ALTER TABLE "Offer" DROP CONSTRAINT "Offer_createdById_fkey";

-- DropForeignKey
ALTER TABLE "OfferStatusHistory" DROP CONSTRAINT "OfferStatusHistory_changedById_fkey";

-- DropForeignKey
ALTER TABLE "OfferStatusHistory" DROP CONSTRAINT "OfferStatusHistory_offerId_fkey";

-- DropForeignKey
ALTER TABLE "Onboarding" DROP CONSTRAINT "Onboarding_assignedToId_fkey";

-- DropForeignKey
ALTER TABLE "Onboarding" DROP CONSTRAINT "Onboarding_offerId_fkey";

-- DropForeignKey
ALTER TABLE "OnboardingTask" DROP CONSTRAINT "OnboardingTask_doneById_fkey";

-- DropForeignKey
ALTER TABLE "OnboardingTask" DROP CONSTRAINT "OnboardingTask_onboardingId_fkey";

-- DropTable
DROP TABLE "Application";

-- DropTable
DROP TABLE "ApplicationStatusHistory";

-- DropTable
DROP TABLE "Candidate";

-- DropTable
DROP TABLE "CandidateTag";

-- DropTable
DROP TABLE "CommunicationLog";

-- DropTable
DROP TABLE "FileAsset";

-- DropTable
DROP TABLE "Interview";

-- DropTable
DROP TABLE "InterviewFeedback";

-- DropTable
DROP TABLE "InterviewPanelMember";

-- DropTable
DROP TABLE "Offer";

-- DropTable
DROP TABLE "OfferStatusHistory";

-- DropTable
DROP TABLE "Onboarding";

-- DropTable
DROP TABLE "OnboardingTask";

-- DropEnum
DROP TYPE "ApplicationStatus";

-- DropEnum
DROP TYPE "CandidateSource";

-- DropEnum
DROP TYPE "CommStatus";

-- DropEnum
DROP TYPE "CommunicationChannel";

-- DropEnum
DROP TYPE "CommunicationDirection";

-- DropEnum
DROP TYPE "FeedbackVerdict";

-- DropEnum
DROP TYPE "FileEntityType";

-- DropEnum
DROP TYPE "FilePurpose";

-- DropEnum
DROP TYPE "InterviewMode";

-- DropEnum
DROP TYPE "InterviewStatus";

-- DropEnum
DROP TYPE "InterviewType";

-- DropEnum
DROP TYPE "OfferStatus";

-- DropEnum
DROP TYPE "OnboardingStatus";

-- DropEnum
DROP TYPE "OnboardingTaskCategory";

-- DropEnum
DROP TYPE "ResumeParseStatus";

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "BusinessUnit_isActive_idx" ON "BusinessUnit"("isActive");

-- CreateIndex
CREATE INDEX "Client_status_idx" ON "Client"("status");

-- CreateIndex
CREATE INDEX "Client_businessUnitId_idx" ON "Client"("businessUnitId");

-- CreateIndex
CREATE INDEX "ClientContact_clientId_isActive_idx" ON "ClientContact"("clientId", "isActive");

-- CreateIndex
CREATE INDEX "ClientNote_clientId_idx" ON "ClientNote"("clientId");

-- CreateIndex
CREATE INDEX "OrgFlow_fromType_fromId_idx" ON "OrgFlow"("fromType", "fromId");

-- CreateIndex
CREATE INDEX "OrgFlow_toType_toId_idx" ON "OrgFlow"("toType", "toId");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "Requirement_businessUnitId_idx" ON "Requirement"("businessUnitId");

-- CreateIndex
CREATE INDEX "RequirementDocument_requirementId_idx" ON "RequirementDocument"("requirementId");

-- CreateIndex
CREATE INDEX "RequirementNote_requirementId_idx" ON "RequirementNote"("requirementId");

-- CreateIndex
CREATE INDEX "RequirementStatusHistory_requirementId_idx" ON "RequirementStatusHistory"("requirementId");

-- CreateIndex
CREATE INDEX "Team_isActive_idx" ON "Team"("isActive");

-- CreateIndex
CREATE INDEX "Team_businessUnitId_idx" ON "Team"("businessUnitId");

-- CreateIndex
CREATE INDEX "TeamMember_teamId_isActive_idx" ON "TeamMember"("teamId", "isActive");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_isActive_idx" ON "User"("isActive");

-- CreateIndex
CREATE INDEX "User_roleId_idx" ON "User"("roleId");
