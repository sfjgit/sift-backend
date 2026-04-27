/*
  Warnings:

  - You are about to drop the column `isActive` on the `ClientContact` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "ClientHandlerStatus" AS ENUM ('ACTIVE', 'REMOVED', 'REPLACED');

-- CreateEnum
CREATE TYPE "ClientContactStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'REMOVED');

-- DropIndex
DROP INDEX "ClientContact_clientId_isActive_idx";

-- DropIndex
DROP INDEX "ClientHandler_clientId_role_key";

-- AlterTable
ALTER TABLE "ClientContact" DROP COLUMN "isActive",
ADD COLUMN     "ownerId" TEXT,
ADD COLUMN     "status" "ClientContactStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "ClientHandler" ADD COLUMN     "removedAt" TIMESTAMP(3),
ADD COLUMN     "removedReason" TEXT,
ADD COLUMN     "status" "ClientHandlerStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateIndex
CREATE INDEX "ClientContact_clientId_status_idx" ON "ClientContact"("clientId", "status");

-- CreateIndex
CREATE INDEX "ClientHandler_clientId_status_idx" ON "ClientHandler"("clientId", "status");

-- AddForeignKey
ALTER TABLE "ClientContact" ADD CONSTRAINT "ClientContact_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
