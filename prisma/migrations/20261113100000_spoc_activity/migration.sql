-- CreateEnum
CREATE TYPE "WorkTaskKind" AS ENUM ('TASK', 'CALL');

-- CreateEnum
CREATE TYPE "WorkTaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ClientActivityType" ADD VALUE 'NOTE_UPDATED';
ALTER TYPE "ClientActivityType" ADD VALUE 'TASK_ADDED';
ALTER TYPE "ClientActivityType" ADD VALUE 'TASK_UPDATED';
ALTER TYPE "ClientActivityType" ADD VALUE 'TASK_CLOSED';
ALTER TYPE "ClientActivityType" ADD VALUE 'SALES_STATUS_CHANGED';
ALTER TYPE "ClientActivityType" ADD VALUE 'INTERACTION_LOGGED';

-- AlterTable
ALTER TABLE "ClientSpoc" ADD COLUMN     "address" TEXT,
ADD COLUMN     "callConnected" BOOLEAN,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "decisionAuthorityId" TEXT,
ADD COLUMN     "distanceKm" DECIMAL(8,1),
ADD COLUMN     "district" TEXT,
ADD COLUMN     "latitude" DECIMAL(9,6),
ADD COLUMN     "longitude" DECIMAL(9,6),
ADD COLUMN     "orgTypeId" TEXT,
ADD COLUMN     "phone2" TEXT,
ADD COLUMN     "phone3" TEXT,
ADD COLUMN     "pincode" TEXT,
ADD COLUMN     "revenueBandId" TEXT,
ADD COLUMN     "roleCategoryId" TEXT,
ADD COLUMN     "state" TEXT;

-- AlterTable
ALTER TABLE "ClientNote" ADD COLUMN     "editedAt" TIMESTAMP(3),
ADD COLUMN     "spocId" TEXT;

-- CreateTable
CREATE TABLE "WorkTask" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "spocId" TEXT,
    "kind" "WorkTaskKind" NOT NULL DEFAULT 'TASK',
    "title" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3),
    "status" "WorkTaskStatus" NOT NULL DEFAULT 'OPEN',
    "assigneeId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "closeNote" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkTask_tenantId_assigneeId_status_idx" ON "WorkTask"("tenantId", "assigneeId", "status");

-- CreateIndex
CREATE INDEX "WorkTask_clientId_idx" ON "WorkTask"("clientId");

-- CreateIndex
CREATE INDEX "WorkTask_spocId_idx" ON "WorkTask"("spocId");

-- CreateIndex
CREATE INDEX "ClientNote_spocId_idx" ON "ClientNote"("spocId");

-- AddForeignKey
ALTER TABLE "ClientSpoc" ADD CONSTRAINT "ClientSpoc_roleCategoryId_fkey" FOREIGN KEY ("roleCategoryId") REFERENCES "Lookup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientSpoc" ADD CONSTRAINT "ClientSpoc_decisionAuthorityId_fkey" FOREIGN KEY ("decisionAuthorityId") REFERENCES "Lookup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientSpoc" ADD CONSTRAINT "ClientSpoc_orgTypeId_fkey" FOREIGN KEY ("orgTypeId") REFERENCES "Lookup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientSpoc" ADD CONSTRAINT "ClientSpoc_revenueBandId_fkey" FOREIGN KEY ("revenueBandId") REFERENCES "Lookup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientNote" ADD CONSTRAINT "ClientNote_spocId_fkey" FOREIGN KEY ("spocId") REFERENCES "ClientSpoc"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkTask" ADD CONSTRAINT "WorkTask_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkTask" ADD CONSTRAINT "WorkTask_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkTask" ADD CONSTRAINT "WorkTask_spocId_fkey" FOREIGN KEY ("spocId") REFERENCES "ClientSpoc"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkTask" ADD CONSTRAINT "WorkTask_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkTask" ADD CONSTRAINT "WorkTask_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkTask" ADD CONSTRAINT "WorkTask_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

