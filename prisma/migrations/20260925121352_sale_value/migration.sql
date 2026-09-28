/*
  Warnings:

  - You are about to alter the column `saleValue` on the `Requirement` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(14,2)`.

*/
-- CreateEnum
CREATE TYPE "SaleValueBasis" AS ENUM ('DIRECT', 'BAND', 'FIXED_PCT');

-- CreateEnum
CREATE TYPE "AchievementStatus" AS ENUM ('ACTIVE', 'REVERSED');

-- DropForeignKey
ALTER TABLE "PortalRecruitLog" DROP CONSTRAINT "PortalRecruitLog_assignmentId_fkey";

-- DropForeignKey
ALTER TABLE "PortalRecruitLog" DROP CONSTRAINT "PortalRecruitLog_requirementId_fkey";

-- AlterTable
ALTER TABLE "Requirement" ADD COLUMN     "perOpeningValue" DECIMAL(14,2),
ADD COLUMN     "saleValueBasis" "SaleValueBasis",
ADD COLUMN     "saleValueFrozenAt" TIMESTAMP(3),
ADD COLUMN     "saleValueRate" DECIMAL(14,4),
ALTER COLUMN "saleValue" SET DATA TYPE DECIMAL(14,2);
