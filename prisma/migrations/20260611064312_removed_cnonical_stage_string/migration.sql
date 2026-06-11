/*
  Warnings:

  - You are about to drop the column `currentCanonicalStage` on the `RequirementCandidatePipeline` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "RequirementCandidatePipeline_requirementId_currentCanonical_idx";

-- AlterTable
ALTER TABLE "RequirementCandidatePipeline" DROP COLUMN "currentCanonicalStage";
