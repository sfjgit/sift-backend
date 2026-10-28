-- CreateEnum
CREATE TYPE "QuotaPeriod" AS ENUM ('DAY', 'WEEK', 'MONTH');

-- AlterEnum
ALTER TYPE "ClientActivityType" ADD VALUE 'CLIENT_ASSIGNED';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'CLIENT_ASSIGNED';

-- AlterTable
ALTER TABLE "PipelineStep" ADD COLUMN     "rerunAfterDays" INTEGER;

-- CreateTable
CREATE TABLE "ClientAssignment" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "note" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "ClientAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunQuota" (
    "id" TEXT NOT NULL,
    "stepId" TEXT,
    "roleId" TEXT,
    "userId" TEXT,
    "period" "QuotaPeriod" NOT NULL,
    "maxRuns" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RunQuota_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientAssignment_clientId_endedAt_idx" ON "ClientAssignment"("clientId", "endedAt");

-- CreateIndex
CREATE INDEX "ClientAssignment_userId_endedAt_idx" ON "ClientAssignment"("userId", "endedAt");

-- CreateIndex
CREATE INDEX "RunQuota_isActive_idx" ON "RunQuota"("isActive");

-- AddForeignKey
ALTER TABLE "ClientAssignment" ADD CONSTRAINT "ClientAssignment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientAssignment" ADD CONSTRAINT "ClientAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientAssignment" ADD CONSTRAINT "ClientAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunQuota" ADD CONSTRAINT "RunQuota_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "PipelineStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunQuota" ADD CONSTRAINT "RunQuota_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunQuota" ADD CONSTRAINT "RunQuota_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunQuota" ADD CONSTRAINT "RunQuota_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- default re-run windows (days); admins change them on Integrations
UPDATE "PipelineStep" SET "rerunAfterDays" = 90 WHERE "key" IN ('reports', 'report_spocs', 'figures');
UPDATE "PipelineStep" SET "rerunAfterDays" = 30 WHERE "key" IN ('enrich', 'apollo', 'emails');
UPDATE "PipelineStep" SET "rerunAfterDays" = 14 WHERE "key" = 'validate';
