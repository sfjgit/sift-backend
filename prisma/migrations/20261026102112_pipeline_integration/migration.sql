-- CreateEnum
CREATE TYPE "SpocApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ClientActivityType" ADD VALUE 'SPOC_APPROVED';
ALTER TYPE "ClientActivityType" ADD VALUE 'SPOC_REJECTED';

-- AlterTable
ALTER TABLE "ClientSpoc" ADD COLUMN     "approvalNote" TEXT,
ADD COLUMN     "approvalStatus" "SpocApprovalStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "fieldSources" JSONB,
ADD COLUMN     "reviewFlag" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reviewReason" TEXT;

-- CreateIndex
CREATE INDEX "ClientSpoc_approvalStatus_idx" ON "ClientSpoc"("approvalStatus");

-- AddForeignKey
ALTER TABLE "ClientSpoc" ADD CONSTRAINT "ClientSpoc_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- SPOCs added by hand before approvals existed were vetted by a person: start them APPROVED
UPDATE "ClientSpoc"
SET "approvalStatus" = 'APPROVED', "approvedById" = "addedById", "approvedAt" = "createdAt"
WHERE "sourceRunId" IS NULL;
