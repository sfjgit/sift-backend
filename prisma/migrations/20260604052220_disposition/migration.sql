-- CreateEnum
CREATE TYPE "CandidateDisposition" AS ENUM ('ACTIVE', 'PLACED', 'DROPPED', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "DropReason" AS ENUM ('CLIENT_REJECTED', 'CANDIDATE_DECLINED', 'OFFER_EXPIRED', 'NO_SHOW', 'UNRESPONSIVE', 'OVERQUALIFIED', 'BUDGET_MISMATCH', 'OTHER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AssignmentStatus" ADD VALUE 'FILLED';
ALTER TYPE "AssignmentStatus" ADD VALUE 'EXPIRED';

-- AlterTable
ALTER TABLE "RequirementCandidatePipeline" ADD COLUMN     "disposition" "CandidateDisposition" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "dispositionAt" TIMESTAMP(3),
ADD COLUMN     "dropNote" TEXT,
ADD COLUMN     "dropReason" "DropReason";
