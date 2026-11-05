-- Multi-tenant CRM. Every existing row becomes SFJBS's (the first tenant).
-- tenantId columns are added with SFJBS as a constant default (no table rewrite
-- on Postgres 11+, fast at millions of rows), then the default is dropped so
-- new rows must name their tenant.

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "ClientEntityType" AS ENUM ('COMPANY', 'GOVERNMENT', 'INSTITUTION');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "plan" TEXT NOT NULL DEFAULT 'STANDARD',
    "maxUsers" INTEGER,
    "settings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

INSERT INTO "Tenant" ("id", "slug", "name", "legalName", "status", "plan", "updatedAt")
VALUES ('a5f1b2c3-0001-4000-8000-5f1b5c5f1b51', 'sfjbs', 'SFJBS', NULL, 'ACTIVE', 'ENTERPRISE', now());

-- DropIndex
DROP INDEX "Lookup_type_isActive_idx";

-- DropIndex
DROP INDEX "Lookup_type_code_key";

-- DropIndex
DROP INDEX "BusinessUnit_name_key";

-- DropIndex
DROP INDEX "BusinessUnit_code_key";

-- DropIndex
DROP INDEX "BusinessUnit_isActive_idx";

-- DropIndex
DROP INDEX "ServiceLine_name_key";

-- DropIndex
DROP INDEX "ServiceLine_code_key";

-- DropIndex
DROP INDEX "ServiceLine_isActive_idx";

-- DropIndex
DROP INDEX "Department_name_key";

-- DropIndex
DROP INDEX "Department_isActive_idx";

-- DropIndex
DROP INDEX "Designation_name_key";

-- DropIndex
DROP INDEX "Designation_isActive_idx";

-- DropIndex
DROP INDEX "User_employeeId_key";

-- DropIndex
DROP INDEX "User_legacyCaspaId_key";

-- DropIndex
DROP INDEX "User_isActive_idx";

-- DropIndex
DROP INDEX "Role_name_key";

-- DropIndex
DROP INDEX "Client_cin_key";

-- DropIndex
DROP INDEX "Client_legacyCaspaId_key";

-- DropIndex
DROP INDEX "Client_deletedAt_createdAt_idx";

-- DropIndex
DROP INDEX "Client_deletedAt_name_idx";

-- DropIndex
DROP INDEX "ClientSpoc_email_key";

-- DropIndex
DROP INDEX "ClientSpoc_legacyCaspaId_key";

-- DropIndex
DROP INDEX "RunQuota_isActive_idx";

-- DropIndex
DROP INDEX "AuditLog_createdAt_idx";

-- DropIndex
DROP INDEX "SavedView_module_isShared_idx";

-- DropIndex
DROP INDEX "Faq_category_order_idx";

-- AlterTable
ALTER TABLE "Lookup" ADD COLUMN     "tenantId" TEXT NOT NULL DEFAULT 'a5f1b2c3-0001-4000-8000-5f1b5c5f1b51';

-- AlterTable
ALTER TABLE "BusinessUnit" ADD COLUMN     "tenantId" TEXT NOT NULL DEFAULT 'a5f1b2c3-0001-4000-8000-5f1b5c5f1b51';

-- AlterTable
ALTER TABLE "ServiceLine" ADD COLUMN     "tenantId" TEXT NOT NULL DEFAULT 'a5f1b2c3-0001-4000-8000-5f1b5c5f1b51';

-- AlterTable
ALTER TABLE "Department" ADD COLUMN     "tenantId" TEXT NOT NULL DEFAULT 'a5f1b2c3-0001-4000-8000-5f1b5c5f1b51';

-- AlterTable
ALTER TABLE "Designation" ADD COLUMN     "tenantId" TEXT NOT NULL DEFAULT 'a5f1b2c3-0001-4000-8000-5f1b5c5f1b51';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tenantId" TEXT NOT NULL DEFAULT 'a5f1b2c3-0001-4000-8000-5f1b5c5f1b51';

-- AlterTable
ALTER TABLE "Role" ADD COLUMN     "tenantId" TEXT NOT NULL DEFAULT 'a5f1b2c3-0001-4000-8000-5f1b5c5f1b51';

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "csrFy" TEXT,
ADD COLUMN     "csrSpentRs" DECIMAL(16,2),
ADD COLUMN     "employeeCount" INTEGER,
ADD COLUMN     "employeeSizeId" TEXT,
ADD COLUMN     "entityType" "ClientEntityType" NOT NULL DEFAULT 'COMPANY',
ADD COLUMN     "tenantId" TEXT NOT NULL DEFAULT 'a5f1b2c3-0001-4000-8000-5f1b5c5f1b51';

-- AlterTable
ALTER TABLE "ClientSpoc" ADD COLUMN     "tenantId" TEXT NOT NULL DEFAULT 'a5f1b2c3-0001-4000-8000-5f1b5c5f1b51';

-- AlterTable
ALTER TABLE "StepRun" ADD COLUMN     "tenantId" TEXT NOT NULL DEFAULT 'a5f1b2c3-0001-4000-8000-5f1b5c5f1b51';

-- AlterTable
ALTER TABLE "RunQuota" ADD COLUMN     "tenantId" TEXT NOT NULL DEFAULT 'a5f1b2c3-0001-4000-8000-5f1b5c5f1b51';

-- AlterTable
ALTER TABLE "SystemAlert" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "tenantId" TEXT NOT NULL DEFAULT 'a5f1b2c3-0001-4000-8000-5f1b5c5f1b51';

-- AlterTable
ALTER TABLE "SavedView" ADD COLUMN     "tenantId" TEXT NOT NULL DEFAULT 'a5f1b2c3-0001-4000-8000-5f1b5c5f1b51';

-- AlterTable
ALTER TABLE "Faq" ADD COLUMN     "tenantId" TEXT NOT NULL DEFAULT 'a5f1b2c3-0001-4000-8000-5f1b5c5f1b51';

-- CreateTable
CREATE TABLE "ClientCorporateFinancial" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "fy" TEXT NOT NULL,
    "revenueRs" DECIMAL(18,2),
    "netProfitRs" DECIMAL(18,2),
    "paidUpCapitalRs" DECIMAL(18,2),
    "authorisedCapitalRs" DECIMAL(18,2),
    "netWorthRs" DECIMAL(18,2),
    "source" TEXT,
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientCorporateFinancial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE INDEX "Tenant_status_idx" ON "Tenant"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ClientCorporateFinancial_clientId_fy_key" ON "ClientCorporateFinancial"("clientId", "fy");

-- CreateIndex
CREATE INDEX "Lookup_tenantId_type_isActive_idx" ON "Lookup"("tenantId", "type", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Lookup_tenantId_type_code_key" ON "Lookup"("tenantId", "type", "code");

-- CreateIndex
CREATE INDEX "BusinessUnit_tenantId_isActive_idx" ON "BusinessUnit"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessUnit_tenantId_name_key" ON "BusinessUnit"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessUnit_tenantId_code_key" ON "BusinessUnit"("tenantId", "code");

-- CreateIndex
CREATE INDEX "ServiceLine_tenantId_isActive_idx" ON "ServiceLine"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceLine_tenantId_name_key" ON "ServiceLine"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceLine_tenantId_code_key" ON "ServiceLine"("tenantId", "code");

-- CreateIndex
CREATE INDEX "Department_tenantId_isActive_idx" ON "Department"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Department_tenantId_name_key" ON "Department"("tenantId", "name");

-- CreateIndex
CREATE INDEX "Designation_tenantId_isActive_idx" ON "Designation"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Designation_tenantId_name_key" ON "Designation"("tenantId", "name");

-- CreateIndex
CREATE INDEX "User_tenantId_isActive_idx" ON "User"("tenantId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "User_tenantId_employeeId_key" ON "User"("tenantId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "User_tenantId_legacyCaspaId_key" ON "User"("tenantId", "legacyCaspaId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_tenantId_name_key" ON "Role"("tenantId", "name");

-- CreateIndex
CREATE INDEX "Client_employeeSizeId_idx" ON "Client"("employeeSizeId");

-- CreateIndex
CREATE INDEX "Client_tenantId_deletedAt_createdAt_idx" ON "Client"("tenantId", "deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "Client_tenantId_deletedAt_name_idx" ON "Client"("tenantId", "deletedAt", "name");

-- CreateIndex
CREATE INDEX "Client_tenantId_deletedAt_csrSpentRs_idx" ON "Client"("tenantId", "deletedAt", "csrSpentRs");

-- CreateIndex
CREATE UNIQUE INDEX "Client_tenantId_cin_key" ON "Client"("tenantId", "cin");

-- CreateIndex
CREATE UNIQUE INDEX "Client_tenantId_legacyCaspaId_key" ON "Client"("tenantId", "legacyCaspaId");

-- CreateIndex
CREATE INDEX "ClientSpoc_tenantId_createdAt_idx" ON "ClientSpoc"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClientSpoc_tenantId_email_key" ON "ClientSpoc"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "ClientSpoc_tenantId_legacyCaspaId_key" ON "ClientSpoc"("tenantId", "legacyCaspaId");

-- CreateIndex
CREATE INDEX "StepRun_tenantId_createdAt_idx" ON "StepRun"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "RunQuota_tenantId_isActive_idx" ON "RunQuota"("tenantId", "isActive");

-- CreateIndex
CREATE INDEX "SystemAlert_tenantId_idx" ON "SystemAlert"("tenantId");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_createdAt_idx" ON "AuditLog"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "SavedView_tenantId_module_isShared_idx" ON "SavedView"("tenantId", "module", "isShared");

-- CreateIndex
CREATE INDEX "Faq_tenantId_category_order_idx" ON "Faq"("tenantId", "category", "order");

-- AddForeignKey
ALTER TABLE "Lookup" ADD CONSTRAINT "Lookup_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessUnit" ADD CONSTRAINT "BusinessUnit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceLine" ADD CONSTRAINT "ServiceLine_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Designation" ADD CONSTRAINT "Designation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_employeeSizeId_fkey" FOREIGN KEY ("employeeSizeId") REFERENCES "Lookup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientSpoc" ADD CONSTRAINT "ClientSpoc_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientCorporateFinancial" ADD CONSTRAINT "ClientCorporateFinancial_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepRun" ADD CONSTRAINT "StepRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunQuota" ADD CONSTRAINT "RunQuota_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemAlert" ADD CONSTRAINT "SystemAlert_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedView" ADD CONSTRAINT "SavedView_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Faq" ADD CONSTRAINT "Faq_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- new rows must say which tenant they belong to
ALTER TABLE "Lookup" ALTER COLUMN "tenantId" DROP DEFAULT;
ALTER TABLE "BusinessUnit" ALTER COLUMN "tenantId" DROP DEFAULT;
ALTER TABLE "ServiceLine" ALTER COLUMN "tenantId" DROP DEFAULT;
ALTER TABLE "Department" ALTER COLUMN "tenantId" DROP DEFAULT;
ALTER TABLE "Designation" ALTER COLUMN "tenantId" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "tenantId" DROP DEFAULT;
ALTER TABLE "Role" ALTER COLUMN "tenantId" DROP DEFAULT;
ALTER TABLE "Client" ALTER COLUMN "tenantId" DROP DEFAULT;
ALTER TABLE "ClientSpoc" ALTER COLUMN "tenantId" DROP DEFAULT;
ALTER TABLE "StepRun" ALTER COLUMN "tenantId" DROP DEFAULT;
ALTER TABLE "RunQuota" ALTER COLUMN "tenantId" DROP DEFAULT;
ALTER TABLE "AuditLog" ALTER COLUMN "tenantId" DROP DEFAULT;
ALTER TABLE "SavedView" ALTER COLUMN "tenantId" DROP DEFAULT;
ALTER TABLE "Faq" ALTER COLUMN "tenantId" DROP DEFAULT;

-- employee size bands (admin-editable under Pick-lists); meta min/max = head count
INSERT INTO "Lookup" ("id", "tenantId", "type", "code", "label", "order", "isActive", "isSystem", "meta", "updatedAt") VALUES
  (gen_random_uuid(), 'a5f1b2c3-0001-4000-8000-5f1b5c5f1b51', 'EMPLOYEE_SIZE', 'E_1_10',        '1–10',          1, true, false, '{"min":1,"max":10}',          now()),
  (gen_random_uuid(), 'a5f1b2c3-0001-4000-8000-5f1b5c5f1b51', 'EMPLOYEE_SIZE', 'E_11_50',       '11–50',         2, true, false, '{"min":11,"max":50}',         now()),
  (gen_random_uuid(), 'a5f1b2c3-0001-4000-8000-5f1b5c5f1b51', 'EMPLOYEE_SIZE', 'E_51_200',      '51–200',        3, true, false, '{"min":51,"max":200}',        now()),
  (gen_random_uuid(), 'a5f1b2c3-0001-4000-8000-5f1b5c5f1b51', 'EMPLOYEE_SIZE', 'E_201_500',     '201–500',       4, true, false, '{"min":201,"max":500}',       now()),
  (gen_random_uuid(), 'a5f1b2c3-0001-4000-8000-5f1b5c5f1b51', 'EMPLOYEE_SIZE', 'E_501_1000',    '501–1,000',     5, true, false, '{"min":501,"max":1000}',      now()),
  (gen_random_uuid(), 'a5f1b2c3-0001-4000-8000-5f1b5c5f1b51', 'EMPLOYEE_SIZE', 'E_1001_5000',   '1,001–5,000',   6, true, false, '{"min":1001,"max":5000}',     now()),
  (gen_random_uuid(), 'a5f1b2c3-0001-4000-8000-5f1b5c5f1b51', 'EMPLOYEE_SIZE', 'E_5001_10000',  '5,001–10,000',  7, true, false, '{"min":5001,"max":10000}',    now()),
  (gen_random_uuid(), 'a5f1b2c3-0001-4000-8000-5f1b5c5f1b51', 'EMPLOYEE_SIZE', 'E_10001_PLUS',  '10,000+',       8, true, false, '{"min":10001,"max":null}',    now())
ON CONFLICT ("tenantId", "type", "code") DO NOTHING;

-- latest CSR spend on the client (list filter / sort without a join)
UPDATE "Client" c
SET "csrFy" = f."fy", "csrSpentRs" = f."spentRs"
FROM (
  SELECT DISTINCT ON ("clientId") "clientId", "fy", "spentRs"
  FROM "ClientFinancial"
  WHERE "spentRs" IS NOT NULL
  ORDER BY "clientId", "fy" DESC
) f
WHERE f."clientId" = c."id";

-- the seeded super admin runs the enterprise console
UPDATE "User" SET "isPlatformAdmin" = true WHERE "email" = 'siva.sarathy@sfjbs.com';
