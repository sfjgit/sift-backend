/*
  Warnings:

  - You are about to drop the column `activeApplications` on the `Requirement` table. All the data in the column will be lost.
  - You are about to drop the column `endDate` on the `Requirement` table. All the data in the column will be lost.
  - You are about to drop the column `filledOpenings` on the `Requirement` table. All the data in the column will be lost.
  - You are about to drop the column `interviewsScheduled` on the `Requirement` table. All the data in the column will be lost.
  - You are about to drop the column `location` on the `Requirement` table. All the data in the column will be lost.
  - You are about to drop the column `offersRolledOut` on the `Requirement` table. All the data in the column will be lost.
  - You are about to drop the column `skills` on the `Requirement` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "JobOpenFor" AS ENUM ('EXTERNAL', 'INTERNAL', 'BOTH');

-- CreateEnum
CREATE TYPE "ClosureReason" AS ENUM ('FILLED', 'CANCELLED', 'CLIENT_WITHDREW', 'ON_HOLD');

-- CreateEnum
CREATE TYPE "JDParseStatus" AS ENUM ('PARSED', 'FAILED', 'MANUALLY_OVERRIDDEN');

-- AlterTable
ALTER TABLE "Requirement" DROP COLUMN "activeApplications",
DROP COLUMN "endDate",
DROP COLUMN "filledOpenings",
DROP COLUMN "interviewsScheduled",
DROP COLUMN "location",
DROP COLUMN "offersRolledOut",
DROP COLUMN "skills",
ADD COLUMN     "bonusAmount" DOUBLE PRECISION,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "closureReason" "ClosureReason",
ADD COLUMN     "education" TEXT,
ADD COLUMN     "functionalArea" TEXT,
ADD COLUMN     "hideSalaryFromCandidate" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "jdParseStatus" "JDParseStatus",
ADD COLUMN     "jdParsedAt" TIMESTAMP(3),
ADD COLUMN     "jdParsedFields" TEXT[],
ADD COLUMN     "jobOpenFor" "JobOpenFor" NOT NULL DEFAULT 'EXTERNAL',
ADD COLUMN     "keySkills" TEXT[],
ADD COLUMN     "noPoachCompanies" TEXT[],
ADD COLUMN     "primarySkills" TEXT[],
ADD COLUMN     "salaryCurrency" TEXT DEFAULT 'INR',
ADD COLUMN     "shift" TEXT,
ADD COLUMN     "showMedianSalary" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "state" TEXT,
ADD COLUMN     "targetCompanies" TEXT[],
ADD COLUMN     "targetDate" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Requirement_closureReason_idx" ON "Requirement"("closureReason");

-- CreateIndex
CREATE INDEX "Requirement_targetDate_idx" ON "Requirement"("targetDate");
