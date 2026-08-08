-- CreateEnum
CREATE TYPE "CandidateSnapshotType" AS ENUM ('CANDIDATE', 'APPLICANT');

-- DropForeignKey
ALTER TABLE "CandidateSnapshot" DROP CONSTRAINT "CandidateSnapshot_createdById_fkey";

-- AlterTable
ALTER TABLE "CandidateSnapshot" ADD COLUMN     "type" "CandidateSnapshotType" NOT NULL DEFAULT 'CANDIDATE',
ALTER COLUMN "createdById" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "CandidateSnapshot_type_idx" ON "CandidateSnapshot"("type");

-- AddForeignKey
ALTER TABLE "CandidateSnapshot" ADD CONSTRAINT "CandidateSnapshot_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
