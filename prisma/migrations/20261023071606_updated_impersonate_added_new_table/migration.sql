-- CreateTable
CREATE TABLE "ImpersonationActionLog" (
    "id" TEXT NOT NULL,
    "impersonationLogId" TEXT NOT NULL,
    "impersonatorId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "requestBody" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImpersonationActionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImpersonationActionLog_impersonationLogId_idx" ON "ImpersonationActionLog"("impersonationLogId");

-- CreateIndex
CREATE INDEX "ImpersonationActionLog_targetUserId_createdAt_idx" ON "ImpersonationActionLog"("targetUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "ImpersonationActionLog" ADD CONSTRAINT "ImpersonationActionLog_impersonationLogId_fkey" FOREIGN KEY ("impersonationLogId") REFERENCES "ImpersonationLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
