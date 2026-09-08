-- AlterTable
ALTER TABLE "RequirementCandidatePipeline" ADD COLUMN     "isTransferred" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "transferredAt" TIMESTAMP(3);
