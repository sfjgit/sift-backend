-- CreateEnum
CREATE TYPE "AiMode" AS ENUM ('OFF', 'COMMAND', 'CANVAS');

-- CreateEnum
CREATE TYPE "AiUsageMode" AS ENUM ('COMMAND', 'CANVAS', 'EXPORT');

-- CreateEnum
CREATE TYPE "AiQuotaPeriod" AS ENUM ('DAY', 'WEEK', 'MONTH');

-- CreateTable
CREATE TABLE "AiModeSetting" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "commandEnabled" BOOLEAN NOT NULL DEFAULT false,
    "canvasEnabled" BOOLEAN NOT NULL DEFAULT false,
    "monthlyBudgetInr" DECIMAL(12,2) NOT NULL DEFAULT 5000,
    "alertThresholds" JSONB NOT NULL DEFAULT '[50, 80, 100]',
    "alertsSent" JSONB NOT NULL DEFAULT '{}',
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiModeSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUserPreference" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mode" "AiMode" NOT NULL DEFAULT 'OFF',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiUserPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiQuotaPolicy" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "roleId" TEXT,
    "mode" "AiUsageMode" NOT NULL,
    "period" "AiQuotaPeriod" NOT NULL,
    "maxCount" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiQuotaPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUserQuotaOverride" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mode" "AiUsageMode" NOT NULL,
    "period" "AiQuotaPeriod" NOT NULL,
    "maxCount" INTEGER,
    "reason" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiUserQuotaOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiModelPricing" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputPerMTokUsd" DECIMAL(10,4) NOT NULL,
    "outputPerMTokUsd" DECIMAL(10,4) NOT NULL,
    "cacheReadPerMTokUsd" DECIMAL(10,4) NOT NULL,
    "cacheWritePerMTokUsd" DECIMAL(10,4) NOT NULL,
    "usdToInr" DECIMAL(10,4) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiModelPricing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommandTemplate" (
    "id" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "paramMap" JSONB NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'llm',
    "hitCount" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommandTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportTemplate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prompt" TEXT,
    "spec" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiAuditLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleId" TEXT,
    "buId" TEXT,
    "mode" "AiMode" NOT NULL,
    "usageMode" "AiUsageMode",
    "input" TEXT NOT NULL,
    "template" TEXT,
    "tier" TEXT NOT NULL,
    "action" TEXT,
    "params" JSONB,
    "outcome" TEXT NOT NULL,
    "countsToQuota" BOOLEAN NOT NULL DEFAULT false,
    "model" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "costInr" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiModeSetting_tenantId_key" ON "AiModeSetting"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "AiUserPreference_userId_key" ON "AiUserPreference"("userId");

-- CreateIndex
CREATE INDEX "AiUserPreference_tenantId_idx" ON "AiUserPreference"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "AiQuotaPolicy_tenantId_roleId_mode_period_key" ON "AiQuotaPolicy"("tenantId", "roleId", "mode", "period");

-- CreateIndex
CREATE INDEX "AiUserQuotaOverride_tenantId_idx" ON "AiUserQuotaOverride"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "AiUserQuotaOverride_userId_mode_period_key" ON "AiUserQuotaOverride"("userId", "mode", "period");

-- CreateIndex
CREATE INDEX "AiModelPricing_model_effectiveFrom_idx" ON "AiModelPricing"("model", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "CommandTemplate_template_key" ON "CommandTemplate"("template");

-- CreateIndex
CREATE INDEX "ReportTemplate_tenantId_createdById_idx" ON "ReportTemplate"("tenantId", "createdById");

-- CreateIndex
CREATE INDEX "AiAuditLog_tenantId_createdAt_idx" ON "AiAuditLog"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "AiAuditLog_userId_createdAt_idx" ON "AiAuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AiAuditLog_roleId_createdAt_idx" ON "AiAuditLog"("roleId", "createdAt");

-- CreateIndex
CREATE INDEX "AiAuditLog_outcome_idx" ON "AiAuditLog"("outcome");

-- CreateIndex
CREATE INDEX "AiAuditLog_tier_createdAt_idx" ON "AiAuditLog"("tier", "createdAt");

