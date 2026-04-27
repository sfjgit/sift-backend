/*
  Warnings:

  - You are about to drop the column `skill` on the `RequirementSkill` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[requirementId,version]` on the table `RequirementJD` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[requirementId,skillId]` on the table `RequirementSkill` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `skillId` to the `RequirementSkill` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "ClientHandler_clientId_userId_key";

-- DropIndex
DROP INDEX "TeamEdge_childId_idx";

-- DropIndex
DROP INDEX "TeamEdge_parentId_idx";

-- AlterTable
ALTER TABLE "RequirementSkill" DROP COLUMN "skill",
ADD COLUMN     "skillId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "Skill" (
    "id" TEXT NOT NULL,
    "canonicalName" TEXT NOT NULL,
    "aliases" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Skill_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Skill_canonicalName_key" ON "Skill"("canonicalName");

-- CreateIndex
CREATE INDEX "ClientHandler_clientId_userId_status_idx" ON "ClientHandler"("clientId", "userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RequirementJD_requirementId_version_key" ON "RequirementJD"("requirementId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "RequirementSkill_requirementId_skillId_key" ON "RequirementSkill"("requirementId", "skillId");

-- CreateIndex
CREATE INDEX "TeamEdge_parentId_edgeType_idx" ON "TeamEdge"("parentId", "edgeType");

-- CreateIndex
CREATE INDEX "TeamEdge_childId_edgeType_idx" ON "TeamEdge"("childId", "edgeType");

-- CreateIndex
CREATE INDEX "TeamMember_userId_idx" ON "TeamMember"("userId");

-- AddForeignKey
ALTER TABLE "RequirementSkill" ADD CONSTRAINT "RequirementSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
