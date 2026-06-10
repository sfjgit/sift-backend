/*
  Warnings:

  - The values [OFFER] on the enum `CanonicalStage` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "CanonicalStage_new" AS ENUM ('SOURCED', 'SCREENING', 'INTERVIEW', 'OFFER_IN_PROGRESS', 'OFFERED', 'HIRED', 'JOINED', 'DROPPED');
ALTER TABLE "RequirementCandidatePipeline" ALTER COLUMN "currentCanonicalStage" TYPE "CanonicalStage_new" USING ("currentCanonicalStage"::text::"CanonicalStage_new");
ALTER TABLE "CandidatePipelineStageLog" ALTER COLUMN "fromCanonicalStage" TYPE "CanonicalStage_new" USING ("fromCanonicalStage"::text::"CanonicalStage_new");
ALTER TABLE "CandidatePipelineStageLog" ALTER COLUMN "toCanonicalStage" TYPE "CanonicalStage_new" USING ("toCanonicalStage"::text::"CanonicalStage_new");
ALTER TABLE "PipelineStage" ALTER COLUMN "canonicalStage" TYPE "CanonicalStage_new" USING ("canonicalStage"::text::"CanonicalStage_new");
ALTER TYPE "CanonicalStage" RENAME TO "CanonicalStage_old";
ALTER TYPE "CanonicalStage_new" RENAME TO "CanonicalStage";
DROP TYPE "public"."CanonicalStage_old";
COMMIT;

-- AlterEnum
ALTER TYPE "PermissionScope" ADD VALUE 'REPORTING_LINE';

-- DropIndex
DROP INDEX "PipelineStage_serviceLineId_idx";

-- AlterTable
ALTER TABLE "PipelineStage" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "ClientSpocDM" (
    "id" TEXT NOT NULL,
    "spocId" TEXT NOT NULL,
    "dmId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientSpocDM_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ClientSpocDM" ADD CONSTRAINT "ClientSpocDM_spocId_fkey" FOREIGN KEY ("spocId") REFERENCES "ClientSpoc"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientSpocDM" ADD CONSTRAINT "ClientSpocDM_dmId_fkey" FOREIGN KEY ("dmId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
