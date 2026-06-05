/*
  Warnings:

  - The `dropReason` column on the `RequirementCandidatePipeline` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterEnum
ALTER TYPE "CandidateDisposition" ADD VALUE 'ON_HOLD';

-- AlterTable
ALTER TABLE "RequirementCandidatePipeline" DROP COLUMN "dropReason",
ADD COLUMN     "dropReason" TEXT;
