/*
  Warnings:

  - You are about to drop the column `ancestorIds` on the `BusinessUnit` table. All the data in the column will be lost.
  - You are about to drop the column `parentBUId` on the `BusinessUnit` table. All the data in the column will be lost.
  - You are about to drop the column `address` on the `Client` table. All the data in the column will be lost.
  - You are about to drop the column `city` on the `Client` table. All the data in the column will be lost.
  - You are about to drop the column `country` on the `Client` table. All the data in the column will be lost.
  - You are about to drop the column `district` on the `Client` table. All the data in the column will be lost.
  - You are about to drop the column `parentClientId` on the `Client` table. All the data in the column will be lost.
  - You are about to drop the column `pincode` on the `Client` table. All the data in the column will be lost.
  - You are about to drop the column `state` on the `Client` table. All the data in the column will be lost.
  - You are about to drop the `BusinessUnitServiceLine` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ClientActivityType" ADD VALUE 'LOCATION_ADDED';
ALTER TYPE "ClientActivityType" ADD VALUE 'TECHNOLOGY_UPDATED';

-- DropForeignKey
ALTER TABLE "BusinessUnit" DROP CONSTRAINT "BusinessUnit_parentBUId_fkey";

-- DropForeignKey
ALTER TABLE "BusinessUnitServiceLine" DROP CONSTRAINT "BusinessUnitServiceLine_businessUnitId_fkey";

-- DropForeignKey
ALTER TABLE "BusinessUnitServiceLine" DROP CONSTRAINT "BusinessUnitServiceLine_serviceLineId_fkey";

-- DropForeignKey
ALTER TABLE "Client" DROP CONSTRAINT "Client_parentClientId_fkey";

-- DropIndex
DROP INDEX "BusinessUnit_ancestorIds_idx";

-- DropIndex
DROP INDEX "BusinessUnit_parentBUId_idx";

-- DropIndex
DROP INDEX "Client_parentClientId_idx";

-- DropIndex
DROP INDEX "ClientSpoc_businessUnitId_idx";

-- AlterTable
ALTER TABLE "BusinessUnit" DROP COLUMN "ancestorIds",
DROP COLUMN "parentBUId";

-- AlterTable
ALTER TABLE "Client" DROP COLUMN "address",
DROP COLUMN "city",
DROP COLUMN "country",
DROP COLUMN "district",
DROP COLUMN "parentClientId",
DROP COLUMN "pincode",
DROP COLUMN "state";

-- AlterTable
ALTER TABLE "ClientSpoc" ADD COLUMN     "locationId" TEXT;

-- DropTable
DROP TABLE "BusinessUnitServiceLine";

-- CreateTable
CREATE TABLE "ClientLocation" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "typeId" TEXT,
    "name" TEXT,
    "addressLine" TEXT,
    "city" TEXT,
    "district" TEXT,
    "state" TEXT,
    "country" TEXT DEFAULT 'India',
    "pincode" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "dmEvidence" TEXT,
    "addedById" TEXT,
    "sourceRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientTechnology" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "addedById" TEXT,
    "sourceRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientTechnology_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientLocation_clientId_isActive_idx" ON "ClientLocation"("clientId", "isActive");

-- CreateIndex
CREATE INDEX "ClientLocation_typeId_idx" ON "ClientLocation"("typeId");

-- CreateIndex
CREATE INDEX "ClientLocation_state_district_idx" ON "ClientLocation"("state", "district");

-- CreateIndex
CREATE INDEX "ClientTechnology_categoryId_idx" ON "ClientTechnology"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientTechnology_clientId_categoryId_key" ON "ClientTechnology"("clientId", "categoryId");

-- CreateIndex
CREATE INDEX "ClientSpoc_locationId_idx" ON "ClientSpoc"("locationId");

-- CreateIndex
CREATE INDEX "ClientSpoc_businessUnitId_serviceLineId_idx" ON "ClientSpoc"("businessUnitId", "serviceLineId");

-- AddForeignKey
ALTER TABLE "ClientLocation" ADD CONSTRAINT "ClientLocation_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientLocation" ADD CONSTRAINT "ClientLocation_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "Lookup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientLocation" ADD CONSTRAINT "ClientLocation_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientLocation" ADD CONSTRAINT "ClientLocation_sourceRunId_fkey" FOREIGN KEY ("sourceRunId") REFERENCES "StepRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientTechnology" ADD CONSTRAINT "ClientTechnology_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientTechnology" ADD CONSTRAINT "ClientTechnology_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Lookup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientTechnology" ADD CONSTRAINT "ClientTechnology_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientTechnology" ADD CONSTRAINT "ClientTechnology_sourceRunId_fkey" FOREIGN KEY ("sourceRunId") REFERENCES "StepRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientSpoc" ADD CONSTRAINT "ClientSpoc_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "ClientLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
