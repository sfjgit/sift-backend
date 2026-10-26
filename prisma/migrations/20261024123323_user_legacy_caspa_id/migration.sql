/*
  Warnings:

  - A unique constraint covering the columns `[legacyCaspaId]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "legacyCaspaId" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "User_legacyCaspaId_key" ON "User"("legacyCaspaId");
