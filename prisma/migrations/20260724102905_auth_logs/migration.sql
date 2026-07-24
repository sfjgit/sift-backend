-- CreateEnum
CREATE TYPE "AuthLogType" AS ENUM ('LOGIN', 'LOGOUT', 'REFRESH', 'PASSWORD_RESET', 'PASSWORD_CHANGE', 'EMAIL_VERIFICATION', 'EMAIL_CHANGE', 'PHONE_VERIFICATION', 'ACCOUNT_CREATED', 'ACCOUNT_DEACTIVATED', 'ACCOUNT_REACTIVATED', 'FAILED_LOGIN');

-- CreateTable
CREATE TABLE "AuthLogs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "type" "AuthLogType" NOT NULL DEFAULT 'LOGIN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthLogs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuthLogs_userId_idx" ON "AuthLogs"("userId");

-- CreateIndex
CREATE INDEX "AuthLogs_type_idx" ON "AuthLogs"("type");

-- CreateIndex
CREATE INDEX "AuthLogs_createdAt_idx" ON "AuthLogs"("createdAt");

-- CreateIndex
CREATE INDEX "AuthLogs_userId_createdAt_idx" ON "AuthLogs"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "AuthLogs" ADD CONSTRAINT "AuthLogs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
