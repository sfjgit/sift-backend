-- CreateTable
CREATE TABLE "ImpersonationLog" (
    "id" TEXT NOT NULL,
    "impersonatorId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "reason" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "ImpersonationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImpersonationLog_impersonatorId_idx" ON "ImpersonationLog"("impersonatorId");

-- CreateIndex
CREATE INDEX "ImpersonationLog_targetUserId_idx" ON "ImpersonationLog"("targetUserId");

-- AddForeignKey
ALTER TABLE "ImpersonationLog" ADD CONSTRAINT "ImpersonationLog_impersonatorId_fkey" FOREIGN KEY ("impersonatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpersonationLog" ADD CONSTRAINT "ImpersonationLog_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
