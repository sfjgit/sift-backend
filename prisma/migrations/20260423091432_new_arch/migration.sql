/*
  Warnings:

  - The `role` column on the `ClientHandler` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the column `deliveryLeadId` on the `Requirement` table. All the data in the column will be lost.
  - You are about to drop the column `teamLeadId` on the `Requirement` table. All the data in the column will be lost.
  - The `salaryType` column on the `Requirement` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the column `dataPolicy` on the `Team` table. All the data in the column will be lost.
  - The `category` column on the `Team` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the `Client` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ContactHandler` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[clientId,role]` on the table `ClientHandler` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "TeamCategory" AS ENUM ('DELIVERY', 'SALES', 'SUPPORT', 'MANAGEMENT');

-- CreateEnum
CREATE TYPE "ClientHandlerRole" AS ENUM ('PRIMARY', 'SECONDARY', 'BACKUP');

-- CreateEnum
CREATE TYPE "ClientCategory" AS ENUM ('PRODUCT', 'SERVICE', 'CONSULTING', 'STAFFING', 'GOVERNMENT', 'NGO', 'OTHER');

-- CreateEnum
CREATE TYPE "SalaryType" AS ENUM ('MONTHLY', 'ANNUAL', 'HOURLY', 'DAILY');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('REQUIREMENT_CREATED', 'REQUIREMENT_APPROVED', 'REQUIREMENT_CLOSED', 'STATUS_CHANGED', 'MANAGER_ASSIGNED', 'TEAM_ASSIGNED', 'RECRUITER_ASSIGNED', 'ASSIGNMENT_REMOVED', 'NOTE_ADDED', 'DOCUMENT_UPLOADED', 'ISSUE_RAISED', 'ISSUE_RESOLVED', 'STATS_UPDATED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('REQUIREMENT_ASSIGNED', 'TEAM_ASSIGNED', 'STATUS_CHANGED', 'REQUIREMENT_CLOSED', 'NOTE_ADDED', 'ISSUE_RAISED', 'DEADLINE_BREACHED', 'DEADLINE_REMINDER');

-- CreateEnum
CREATE TYPE "NotificationReferenceType" AS ENUM ('REQUIREMENT', 'ASSIGNMENT', 'NOTE', 'DOCUMENT');

-- AlterEnum
ALTER TYPE "AssignmentType" ADD VALUE 'MANAGER';

-- AlterEnum
ALTER TYPE "PermissionScope" ADD VALUE 'MANAGER';

-- DropForeignKey
ALTER TABLE "Client" DROP CONSTRAINT "Client_approvedById_fkey";

-- DropForeignKey
ALTER TABLE "Client" DROP CONSTRAINT "Client_businessUnitId_fkey";

-- DropForeignKey
ALTER TABLE "Client" DROP CONSTRAINT "Client_createdById_fkey";

-- DropForeignKey
ALTER TABLE "Client" DROP CONSTRAINT "Client_parentClientId_fkey";

-- DropForeignKey
ALTER TABLE "ClientContact" DROP CONSTRAINT "ClientContact_clientId_fkey";

-- DropForeignKey
ALTER TABLE "ClientHandler" DROP CONSTRAINT "ClientHandler_clientId_fkey";

-- DropForeignKey
ALTER TABLE "ClientNote" DROP CONSTRAINT "ClientNote_clientId_fkey";

-- DropForeignKey
ALTER TABLE "ClientTeamAssignment" DROP CONSTRAINT "ClientTeamAssignment_clientId_fkey";

-- DropForeignKey
ALTER TABLE "ContactHandler" DROP CONSTRAINT "ContactHandler_assignedById_fkey";

-- DropForeignKey
ALTER TABLE "ContactHandler" DROP CONSTRAINT "ContactHandler_contactId_fkey";

-- DropForeignKey
ALTER TABLE "ContactHandler" DROP CONSTRAINT "ContactHandler_userId_fkey";

-- DropForeignKey
ALTER TABLE "Requirement" DROP CONSTRAINT "Requirement_clientId_fkey";

-- DropForeignKey
ALTER TABLE "Requirement" DROP CONSTRAINT "Requirement_deliveryLeadId_fkey";

-- DropForeignKey
ALTER TABLE "Requirement" DROP CONSTRAINT "Requirement_teamLeadId_fkey";

-- AlterTable
ALTER TABLE "ClientHandler" DROP COLUMN "role",
ADD COLUMN     "role" "ClientHandlerRole" NOT NULL DEFAULT 'PRIMARY';

-- AlterTable
ALTER TABLE "Requirement" DROP COLUMN "deliveryLeadId",
DROP COLUMN "teamLeadId",
ADD COLUMN     "activeApplications" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "closedById" TEXT,
ADD COLUMN     "interviewsScheduled" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "isRespondByBreached" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isTurnaroundBreached" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "offersRolledOut" INTEGER NOT NULL DEFAULT 0,
DROP COLUMN "salaryType",
ADD COLUMN     "salaryType" "SalaryType";

-- AlterTable
ALTER TABLE "RequirementAssignment" ADD COLUMN     "breachedAt" TIMESTAMP(3),
ADD COLUMN     "deadline" TIMESTAMP(3),
ADD COLUMN     "deadlineMet" BOOLEAN,
ADD COLUMN     "interviewsCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "parentAssignmentId" TEXT,
ADD COLUMN     "reminderSentAt" TIMESTAMP(3),
ADD COLUMN     "submissionsCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Team" DROP COLUMN "dataPolicy",
DROP COLUMN "category",
ADD COLUMN     "category" "TeamCategory";

-- DropTable
DROP TABLE "Client";

-- DropTable
DROP TABLE "ContactHandler";

-- DropEnum
DROP TYPE "TeamDataPolicy";

-- CreateTable
CREATE TABLE "clients" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vmsName" TEXT,
    "category" "ClientCategory",
    "industry" TEXT,
    "website" TEXT,
    "country" TEXT NOT NULL DEFAULT 'India',
    "state" TEXT,
    "city" TEXT,
    "address" TEXT,
    "status" "ClientStatus" NOT NULL DEFAULT 'PENDING',
    "businessUnitId" TEXT,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "parentClientId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequirementActivity" (
    "id" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "type" "ActivityType" NOT NULL,
    "summary" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequirementActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "referenceId" TEXT NOT NULL,
    "referenceType" "NotificationReferenceType" NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "clients_status_idx" ON "clients"("status");

-- CreateIndex
CREATE INDEX "clients_businessUnitId_idx" ON "clients"("businessUnitId");

-- CreateIndex
CREATE INDEX "RequirementActivity_requirementId_createdAt_idx" ON "RequirementActivity"("requirementId", "createdAt");

-- CreateIndex
CREATE INDEX "RequirementActivity_actorId_idx" ON "RequirementActivity"("actorId");

-- CreateIndex
CREATE INDEX "Notification_userId_isRead_idx" ON "Notification"("userId", "isRead");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClientHandler_clientId_role_key" ON "ClientHandler"("clientId", "role");

-- CreateIndex
CREATE INDEX "Requirement_isRespondByBreached_idx" ON "Requirement"("isRespondByBreached");

-- CreateIndex
CREATE INDEX "Requirement_isTurnaroundBreached_idx" ON "Requirement"("isTurnaroundBreached");

-- CreateIndex
CREATE INDEX "RequirementAssignment_teamId_status_idx" ON "RequirementAssignment"("teamId", "status");

-- CreateIndex
CREATE INDEX "RequirementAssignment_parentAssignmentId_idx" ON "RequirementAssignment"("parentAssignmentId");

-- CreateIndex
CREATE INDEX "RequirementAssignment_deadline_idx" ON "RequirementAssignment"("deadline");

-- CreateIndex
CREATE INDEX "Team_parentTeamId_idx" ON "Team"("parentTeamId");

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "BusinessUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_parentClientId_fkey" FOREIGN KEY ("parentClientId") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientHandler" ADD CONSTRAINT "ClientHandler_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientTeamAssignment" ADD CONSTRAINT "ClientTeamAssignment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientContact" ADD CONSTRAINT "ClientContact_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientNote" ADD CONSTRAINT "ClientNote_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementAssignment" ADD CONSTRAINT "RequirementAssignment_parentAssignmentId_fkey" FOREIGN KEY ("parentAssignmentId") REFERENCES "RequirementAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementActivity" ADD CONSTRAINT "RequirementActivity_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementActivity" ADD CONSTRAINT "RequirementActivity_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
