-- CreateEnum
CREATE TYPE "NotificationSeverity" AS ENUM ('INFO', 'SUCCESS', 'WARNING', 'ERROR');
-- AlterEnum
ALTER TYPE "NotificationReferenceType" ADD VALUE 'SYSTEM_ALERT';
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.
ALTER TYPE "NotificationType" ADD VALUE 'SPOC_APPROVAL_NEEDED';
ALTER TYPE "NotificationType" ADD VALUE 'SYSTEM_ALERT';
-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "businessUnitId" TEXT;
-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "link" TEXT,
ADD COLUMN     "severity" "NotificationSeverity" NOT NULL DEFAULT 'INFO';
-- CreateTable
CREATE TABLE "ClientServiceLine" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "serviceLineId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClientServiceLine_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "SystemAlert" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "severity" "NotificationSeverity" NOT NULL,
    "source" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "meta" JSONB,
    "count" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    CONSTRAINT "SystemAlert_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "ClientServiceLine_serviceLineId_idx" ON "ClientServiceLine"("serviceLineId");
-- CreateIndex
CREATE UNIQUE INDEX "ClientServiceLine_clientId_serviceLineId_key" ON "ClientServiceLine"("clientId", "serviceLineId");
-- CreateIndex
CREATE INDEX "SystemAlert_key_resolvedAt_idx" ON "SystemAlert"("key", "resolvedAt");
-- CreateIndex
CREATE INDEX "SystemAlert_resolvedAt_lastSeenAt_idx" ON "SystemAlert"("resolvedAt", "lastSeenAt");
-- CreateIndex
CREATE INDEX "Client_businessUnitId_idx" ON "Client"("businessUnitId");
-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "BusinessUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ClientServiceLine" ADD CONSTRAINT "ClientServiceLine_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ClientServiceLine" ADD CONSTRAINT "ClientServiceLine_serviceLineId_fkey" FOREIGN KEY ("serviceLineId") REFERENCES "ServiceLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "SystemAlert" ADD CONSTRAINT "SystemAlert_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: a client's BU = the BU most of its SPOCs belong to;
-- its service lines = every SL its SPOCs belong to.
UPDATE "Client" c SET "businessUnitId" = t."businessUnitId"
FROM (
  SELECT DISTINCT ON ("clientId") "clientId", "businessUnitId"
  FROM "ClientSpoc"
  GROUP BY "clientId", "businessUnitId"
  ORDER BY "clientId", COUNT(*) DESC, "businessUnitId"
) t
WHERE t."clientId" = c.id AND c."businessUnitId" IS NULL;

INSERT INTO "ClientServiceLine" ("id", "clientId", "serviceLineId")
SELECT gen_random_uuid()::text, s."clientId", s."serviceLineId"
FROM (SELECT DISTINCT "clientId", "serviceLineId" FROM "ClientSpoc") s
ON CONFLICT ("clientId", "serviceLineId") DO NOTHING;

-- Severity for existing notifications
UPDATE "Notification" SET "severity" = 'ERROR' WHERE "type" = 'STEP_RUN_FAILED';
UPDATE "Notification" SET "severity" = 'SUCCESS' WHERE "type" = 'STEP_RUN_FINISHED';
