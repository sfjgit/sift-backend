-- CreateEnum
CREATE TYPE "ChangeOp" AS ENUM ('CREATE', 'UPDATE', 'DELETE');

-- CreateTable
CREATE TABLE "ChangeLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "actorId" TEXT,
    "batchId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'web',
    "op" "ChangeOp" NOT NULL,
    "model" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "label" TEXT,
    "recordKey" JSONB NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "restoredAt" TIMESTAMP(3),
    "restoredById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChangeLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChangeLog_tenantId_createdAt_idx" ON "ChangeLog"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "ChangeLog_tenantId_op_category_idx" ON "ChangeLog"("tenantId", "op", "category");

-- CreateIndex
CREATE INDEX "ChangeLog_batchId_idx" ON "ChangeLog"("batchId");

