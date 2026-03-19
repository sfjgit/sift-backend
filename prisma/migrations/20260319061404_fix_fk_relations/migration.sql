/*
  Warnings:

  - You are about to drop the column `approvedBy` on the `Client` table. All the data in the column will be lost.
  - You are about to drop the column `createdBy` on the `Client` table. All the data in the column will be lost.
  - You are about to drop the column `assignedBy` on the `ClientHandler` table. All the data in the column will be lost.
  - You are about to drop the column `assignedBy` on the `ClientTeamAssignment` table. All the data in the column will be lost.
  - You are about to drop the column `assignedBy` on the `ContactHandler` table. All the data in the column will be lost.
  - You are about to drop the column `createdBy` on the `OrgFlow` table. All the data in the column will be lost.
  - You are about to drop the column `updatedBy` on the `OrgFlow` table. All the data in the column will be lost.
  - You are about to drop the column `approvedBy` on the `Requirement` table. All the data in the column will be lost.
  - You are about to drop the column `createdBy` on the `Requirement` table. All the data in the column will be lost.
  - You are about to drop the column `assignedBy` on the `RequirementAssignment` table. All the data in the column will be lost.
  - You are about to drop the column `raisedBy` on the `RequirementDocument` table. All the data in the column will be lost.
  - You are about to drop the column `resolvedBy` on the `RequirementDocument` table. All the data in the column will be lost.
  - You are about to drop the column `changedBy` on the `RequirementStatusHistory` table. All the data in the column will be lost.
  - You are about to drop the column `createdBy` on the `User` table. All the data in the column will be lost.
  - Added the required column `createdById` to the `Client` table without a default value. This is not possible if the table is not empty.
  - Added the required column `assignedById` to the `ClientHandler` table without a default value. This is not possible if the table is not empty.
  - Added the required column `assignedById` to the `ClientTeamAssignment` table without a default value. This is not possible if the table is not empty.
  - Added the required column `assignedById` to the `ContactHandler` table without a default value. This is not possible if the table is not empty.
  - Added the required column `createdById` to the `OrgFlow` table without a default value. This is not possible if the table is not empty.
  - Added the required column `createdById` to the `Requirement` table without a default value. This is not possible if the table is not empty.
  - Added the required column `raisedById` to the `RequirementDocument` table without a default value. This is not possible if the table is not empty.
  - Added the required column `changedById` to the `RequirementStatusHistory` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('ACTIVE', 'REMOVED', 'REPLACED');

-- DropIndex
DROP INDEX "RequirementAssignment_requirementId_recruiterId_key";

-- AlterTable
ALTER TABLE "Client" DROP COLUMN "approvedBy",
DROP COLUMN "createdBy",
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "createdById" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "ClientHandler" DROP COLUMN "assignedBy",
ADD COLUMN     "assignedById" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "ClientTeamAssignment" DROP COLUMN "assignedBy",
ADD COLUMN     "assignedById" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "ContactHandler" DROP COLUMN "assignedBy",
ADD COLUMN     "assignedById" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "OrgFlow" DROP COLUMN "createdBy",
DROP COLUMN "updatedBy",
ADD COLUMN     "createdById" TEXT NOT NULL,
ADD COLUMN     "updatedById" TEXT;

-- AlterTable
ALTER TABLE "Requirement" DROP COLUMN "approvedBy",
DROP COLUMN "createdBy",
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "createdById" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "RequirementAssignment" DROP COLUMN "assignedBy",
ADD COLUMN     "assignedById" TEXT,
ADD COLUMN     "isSystemAssigned" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "removedAt" TIMESTAMP(3),
ADD COLUMN     "removedReason" TEXT,
ADD COLUMN     "status" "AssignmentStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "RequirementDocument" DROP COLUMN "raisedBy",
DROP COLUMN "resolvedBy",
ADD COLUMN     "raisedById" TEXT NOT NULL,
ADD COLUMN     "resolvedById" TEXT;

-- AlterTable
ALTER TABLE "RequirementStatusHistory" DROP COLUMN "changedBy",
ADD COLUMN     "changedById" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "TeamMember" ADD COLUMN     "deactivatedAt" TIMESTAMP(3),
ADD COLUMN     "deactivatedById" TEXT,
ADD COLUMN     "deactivationReason" TEXT,
ADD COLUMN     "replacedByMemberId" TEXT,
ADD COLUMN     "replacedByUserId" TEXT;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "createdBy",
ADD COLUMN     "createdById" TEXT;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_deactivatedById_fkey" FOREIGN KEY ("deactivatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_replacedByUserId_fkey" FOREIGN KEY ("replacedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_replacedByMemberId_fkey" FOREIGN KEY ("replacedByMemberId") REFERENCES "TeamMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientHandler" ADD CONSTRAINT "ClientHandler_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientHandler" ADD CONSTRAINT "ClientHandler_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientTeamAssignment" ADD CONSTRAINT "ClientTeamAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactHandler" ADD CONSTRAINT "ContactHandler_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactHandler" ADD CONSTRAINT "ContactHandler_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientNote" ADD CONSTRAINT "ClientNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_deliveryLeadId_fkey" FOREIGN KEY ("deliveryLeadId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_teamLeadId_fkey" FOREIGN KEY ("teamLeadId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementDocument" ADD CONSTRAINT "RequirementDocument_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementDocument" ADD CONSTRAINT "RequirementDocument_raisedById_fkey" FOREIGN KEY ("raisedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementAssignment" ADD CONSTRAINT "RequirementAssignment_recruiterId_fkey" FOREIGN KEY ("recruiterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementAssignment" ADD CONSTRAINT "RequirementAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementNote" ADD CONSTRAINT "RequirementNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementStatusHistory" ADD CONSTRAINT "RequirementStatusHistory_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgFlow" ADD CONSTRAINT "OrgFlow_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgFlow" ADD CONSTRAINT "OrgFlow_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
