/*
  Warnings:

  - You are about to drop the column `actualJoiningDate` on the `RequirementCandidatePipeline` table. All the data in the column will be lost.
  - You are about to drop the column `expectedJoiningDate` on the `RequirementCandidatePipeline` table. All the data in the column will be lost.
  - You are about to drop the column `remainingDaysToJoin` on the `RequirementCandidatePipeline` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "RequirementCandidatePipeline_actualJoiningDate_idx";

-- DropIndex
DROP INDEX "RequirementCandidatePipeline_expectedJoiningDate_idx";

-- AlterTable
ALTER TABLE "RequirementCandidatePipeline" DROP COLUMN "actualJoiningDate",
DROP COLUMN "expectedJoiningDate",
DROP COLUMN "remainingDaysToJoin";
