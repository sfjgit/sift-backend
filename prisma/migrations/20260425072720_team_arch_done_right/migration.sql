/*
  Warnings:

  - You are about to drop the column `fileUrl` on the `RequirementDocument` table. All the data in the column will be lost.
  - You are about to drop the column `passwordPlain` on the `User` table. All the data in the column will be lost.
  - You are about to drop the `OrgFlow` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `clients` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "NodeType" AS ENUM ('MANAGEMENT', 'GROUP', 'INDIVIDUAL');

-- CreateEnum
CREATE TYPE "EdgeType" AS ENUM ('ASSIGNS_TO', 'REPORTS_TO', 'VISIBILITY');

-- CreateEnum
CREATE TYPE "TeamMemberEvent" AS ENUM ('JOINED', 'LEFT', 'REPLACED', 'DEACTIVATED');

-- DropForeignKey
ALTER TABLE "ClientContact" DROP CONSTRAINT "ClientContact_clientId_fkey";

-- DropForeignKey
ALTER TABLE "ClientHandler" DROP CONSTRAINT "ClientHandler_clientId_fkey";

-- DropForeignKey
ALTER TABLE "ClientNote" DROP CONSTRAINT "ClientNote_clientId_fkey";

-- DropForeignKey
ALTER TABLE "ClientTeamAssignment" DROP CONSTRAINT "ClientTeamAssignment_clientId_fkey";

-- DropForeignKey
ALTER TABLE "OrgFlow" DROP CONSTRAINT "OrgFlow_createdById_fkey";

-- DropForeignKey
ALTER TABLE "OrgFlow" DROP CONSTRAINT "OrgFlow_updatedById_fkey";

-- DropForeignKey
ALTER TABLE "Requirement" DROP CONSTRAINT "Requirement_clientId_fkey";

-- DropForeignKey
ALTER TABLE "clients" DROP CONSTRAINT "clients_approvedById_fkey";

-- DropForeignKey
ALTER TABLE "clients" DROP CONSTRAINT "clients_businessUnitId_fkey";

-- DropForeignKey
ALTER TABLE "clients" DROP CONSTRAINT "clients_createdById_fkey";

-- DropForeignKey
ALTER TABLE "clients" DROP CONSTRAINT "clients_parentClientId_fkey";

-- AlterTable
ALTER TABLE "Requirement" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "RequirementAssignment" ADD COLUMN     "teamMemberId" TEXT;

-- AlterTable
ALTER TABLE "RequirementDocument" DROP COLUMN "fileUrl",
ADD COLUMN     "fileKey" TEXT;

-- AlterTable
ALTER TABLE "Team" ADD COLUMN     "nodeType" "NodeType" NOT NULL DEFAULT 'GROUP';

-- AlterTable
ALTER TABLE "User" DROP COLUMN "passwordPlain";

-- DropTable
DROP TABLE "OrgFlow";

-- DropTable
DROP TABLE "clients";

-- DropEnum
DROP TYPE "FlowNodeType";

-- CreateTable
CREATE TABLE "TeamEdge" (
    "id" TEXT NOT NULL,
    "parentId" TEXT NOT NULL,
    "childId" TEXT NOT NULL,
    "edgeType" "EdgeType" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamEdge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMemberHistory" (
    "id" TEXT NOT NULL,
    "teamMemberId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "event" "TeamMemberEvent" NOT NULL,
    "eventAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "performedById" TEXT,
    "reason" TEXT,

    CONSTRAINT "TeamMemberHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamVisibilityConfig" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "membersCanSeePeerReqs" BOOLEAN NOT NULL DEFAULT false,
    "leadCanSeeChildReqs" BOOLEAN NOT NULL DEFAULT true,
    "canSeeInboundReqs" BOOLEAN NOT NULL DEFAULT true,
    "canSeeOutboundReqs" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamVisibilityConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamUnlinkHistory" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "unlinkedFromTeamId" TEXT NOT NULL,
    "unlinkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    "pendingAssignmentsCount" INTEGER NOT NULL DEFAULT 0,
    "unlinkedById" TEXT NOT NULL,

    CONSTRAINT "TeamUnlinkHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vmsName" TEXT,
    "category" "ClientCategory",
    "industry" TEXT,
    "website" TEXT,
    "country" TEXT,
    "state" TEXT,
    "city" TEXT,
    "address" TEXT,
    "status" "ClientStatus" NOT NULL DEFAULT 'PENDING',
    "deletedAt" TIMESTAMP(3),
    "businessUnitId" TEXT,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "parentClientId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeamEdge_parentId_idx" ON "TeamEdge"("parentId");

-- CreateIndex
CREATE INDEX "TeamEdge_childId_idx" ON "TeamEdge"("childId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamEdge_parentId_childId_edgeType_key" ON "TeamEdge"("parentId", "childId", "edgeType");

-- CreateIndex
CREATE INDEX "TeamMemberHistory_teamMemberId_idx" ON "TeamMemberHistory"("teamMemberId");

-- CreateIndex
CREATE INDEX "TeamMemberHistory_teamId_idx" ON "TeamMemberHistory"("teamId");

-- CreateIndex
CREATE INDEX "TeamMemberHistory_userId_idx" ON "TeamMemberHistory"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamVisibilityConfig_teamId_key" ON "TeamVisibilityConfig"("teamId");

-- CreateIndex
CREATE INDEX "TeamUnlinkHistory_teamId_idx" ON "TeamUnlinkHistory"("teamId");

-- CreateIndex
CREATE INDEX "TeamUnlinkHistory_unlinkedFromTeamId_idx" ON "TeamUnlinkHistory"("unlinkedFromTeamId");

-- CreateIndex
CREATE INDEX "Client_status_idx" ON "Client"("status");

-- CreateIndex
CREATE INDEX "Client_businessUnitId_idx" ON "Client"("businessUnitId");

-- CreateIndex
CREATE INDEX "Client_deletedAt_idx" ON "Client"("deletedAt");

-- CreateIndex
CREATE INDEX "Requirement_deletedAt_idx" ON "Requirement"("deletedAt");

-- CreateIndex
CREATE INDEX "RequirementAssignment_teamMemberId_status_idx" ON "RequirementAssignment"("teamMemberId", "status");

-- CreateIndex
CREATE INDEX "RequirementAssignment_assignedById_idx" ON "RequirementAssignment"("assignedById");

-- CreateIndex
CREATE INDEX "Team_nodeType_idx" ON "Team"("nodeType");

-- CreateIndex
CREATE INDEX "User_businessUnitId_idx" ON "User"("businessUnitId");

-- AddForeignKey
ALTER TABLE "TeamEdge" ADD CONSTRAINT "TeamEdge_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamEdge" ADD CONSTRAINT "TeamEdge_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMemberHistory" ADD CONSTRAINT "TeamMemberHistory_teamMemberId_fkey" FOREIGN KEY ("teamMemberId") REFERENCES "TeamMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMemberHistory" ADD CONSTRAINT "TeamMemberHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMemberHistory" ADD CONSTRAINT "TeamMemberHistory_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMemberHistory" ADD CONSTRAINT "TeamMemberHistory_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamVisibilityConfig" ADD CONSTRAINT "TeamVisibilityConfig_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamUnlinkHistory" ADD CONSTRAINT "TeamUnlinkHistory_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamUnlinkHistory" ADD CONSTRAINT "TeamUnlinkHistory_unlinkedFromTeamId_fkey" FOREIGN KEY ("unlinkedFromTeamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamUnlinkHistory" ADD CONSTRAINT "TeamUnlinkHistory_unlinkedById_fkey" FOREIGN KEY ("unlinkedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "BusinessUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_parentClientId_fkey" FOREIGN KEY ("parentClientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientHandler" ADD CONSTRAINT "ClientHandler_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientTeamAssignment" ADD CONSTRAINT "ClientTeamAssignment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientContact" ADD CONSTRAINT "ClientContact_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientNote" ADD CONSTRAINT "ClientNote_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementAssignment" ADD CONSTRAINT "RequirementAssignment_teamMemberId_fkey" FOREIGN KEY ("teamMemberId") REFERENCES "TeamMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
