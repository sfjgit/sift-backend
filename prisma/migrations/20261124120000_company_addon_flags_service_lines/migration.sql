-- Company add-on + add-on flags + service lines (24 Nov 2026)
--  · ClientCompany (table "ClientRegistration" for now) takes the company-only facts from Client:
--    industry, category, employees, size band, LinkedIn employees, group.
--  · ClientCsr takes the latest-CSR cache (latestFy / latestSpentRs).
--  · Client gets hasCompany / isCsr / isGovt (kept by triggers) and ClientServiceLine comes back,
--    kept by a trigger on ClientSpoc: a client's service lines = its active SPOCs' lines.
-- EXPAND ONLY: the old Client columns stay (the deployed build reads them) — dropped after the deploy.

ALTER TABLE "Client" ADD COLUMN "hasCompany" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "isCsr" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "isGovt" BOOLEAN NOT NULL DEFAULT false;


-- AlterTable
ALTER TABLE "ClientRegistration" ADD COLUMN     "categoryId" TEXT,
ADD COLUMN     "employeeCount" INTEGER,
ADD COLUMN     "employeeSizeId" TEXT,
ADD COLUMN     "groupName" TEXT,
ADD COLUMN     "industryId" TEXT,
ADD COLUMN     "linkedinEmployees" INTEGER;

-- AlterTable
ALTER TABLE "ClientCsr" ADD COLUMN     "latestFy" TEXT,
ADD COLUMN     "latestSpentRs" DECIMAL(16,2);

-- CreateTable
CREATE TABLE "ClientServiceLine" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "serviceLineId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientServiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClientServiceLine_serviceLineId_idx" ON "ClientServiceLine"("serviceLineId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientServiceLine_clientId_serviceLineId_key" ON "ClientServiceLine"("clientId", "serviceLineId");

-- CreateIndex
CREATE INDEX "Client_tenantId_deletedAt_hasCompany_idx" ON "Client"("tenantId", "deletedAt", "hasCompany");

-- CreateIndex
CREATE INDEX "Client_tenantId_deletedAt_isCsr_idx" ON "Client"("tenantId", "deletedAt", "isCsr");

-- CreateIndex
CREATE INDEX "Client_tenantId_deletedAt_isGovt_idx" ON "Client"("tenantId", "deletedAt", "isGovt");

-- CreateIndex
CREATE INDEX "ClientRegistration_industryId_idx" ON "ClientRegistration"("industryId");

-- CreateIndex
CREATE INDEX "ClientRegistration_categoryId_idx" ON "ClientRegistration"("categoryId");

-- CreateIndex
CREATE INDEX "ClientRegistration_employeeSizeId_idx" ON "ClientRegistration"("employeeSizeId");

-- CreateIndex
CREATE INDEX "ClientRegistration_employeeCount_idx" ON "ClientRegistration"("employeeCount");

-- CreateIndex
CREATE INDEX "ClientRegistration_tenantId_groupName_idx" ON "ClientRegistration"("tenantId", "groupName");

-- CreateIndex
CREATE INDEX "ClientCsr_latestSpentRs_idx" ON "ClientCsr"("latestSpentRs");

-- CreateIndex
CREATE INDEX "ClientCsr_latestFy_idx" ON "ClientCsr"("latestFy");

-- AddForeignKey
ALTER TABLE "ClientRegistration" ADD CONSTRAINT "ClientRegistration_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "Lookup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientRegistration" ADD CONSTRAINT "ClientRegistration_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Lookup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientRegistration" ADD CONSTRAINT "ClientRegistration_employeeSizeId_fkey" FOREIGN KEY ("employeeSizeId") REFERENCES "Lookup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientServiceLine" ADD CONSTRAINT "ClientServiceLine_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientServiceLine" ADD CONSTRAINT "ClientServiceLine_serviceLineId_fkey" FOREIGN KEY ("serviceLineId") REFERENCES "ServiceLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ── data: company facts → ClientCompany ("ClientRegistration") ─────────────────────────────
UPDATE "ClientRegistration" r SET
  "industryId" = c."industryId", "categoryId" = c."categoryId", "employeeCount" = c."employeeCount",
  "employeeSizeId" = c."employeeSizeId", "linkedinEmployees" = c."linkedinEmployees", "groupName" = c."groupName"
FROM "Client" c WHERE c.id = r."clientId";

-- companies with any of those facts but no row yet (government / institution bodies don't get one)
INSERT INTO "ClientRegistration" ("id","tenantId","clientId","industryId","categoryId","employeeCount","employeeSizeId","linkedinEmployees","groupName","createdAt","updatedAt")
SELECT gen_random_uuid()::text, c."tenantId", c.id, c."industryId", c."categoryId", c."employeeCount", c."employeeSizeId", c."linkedinEmployees", c."groupName", now(), now()
FROM "Client" c
WHERE c."entityType" = 'COMPANY'
  AND NOT EXISTS (SELECT 1 FROM "ClientRegistration" r WHERE r."clientId" = c.id)
  AND (c."industryId" IS NOT NULL OR c."categoryId" IS NOT NULL OR c."employeeCount" IS NOT NULL
       OR c."employeeSizeId" IS NOT NULL OR c."linkedinEmployees" IS NOT NULL OR c."groupName" IS NOT NULL);

-- government bodies without company details: their "industry" is the sector they work in
UPDATE "ClientGovt" g SET "sector" = l."label"
FROM "Client" c JOIN "Lookup" l ON l.id = c."industryId"
WHERE c.id = g."clientId" AND g."sector" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "ClientRegistration" r WHERE r."clientId" = c.id);

-- ── data: latest-CSR cache → ClientCsr ───────────────────────────────────────────────────────
INSERT INTO "ClientCsr" ("id","clientId","createdAt","updatedAt")
SELECT gen_random_uuid()::text, c.id, now(), now() FROM "Client" c
WHERE (c."csrFy" IS NOT NULL OR EXISTS (SELECT 1 FROM "ClientCsrFinancial" f WHERE f."clientId" = c.id))
  AND NOT EXISTS (SELECT 1 FROM "ClientCsr" s WHERE s."clientId" = c.id);
UPDATE "ClientCsr" s SET "latestFy" = c."csrFy", "latestSpentRs" = c."csrSpentRs" FROM "Client" c WHERE c.id = s."clientId";

-- ── flags: which add-ons a client has ───────────────────────────────────────────────────────
UPDATE "Client" c SET
  "hasCompany" = EXISTS (SELECT 1 FROM "ClientRegistration" r WHERE r."clientId" = c.id),
  "isCsr"      = EXISTS (SELECT 1 FROM "ClientCsr" s WHERE s."clientId" = c.id),
  "isGovt"     = EXISTS (SELECT 1 FROM "ClientGovt" g WHERE g."clientId" = c.id);

CREATE OR REPLACE FUNCTION crm_addon_flag() RETURNS trigger AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    EXECUTE format('UPDATE "Client" SET %I = true WHERE id = $1', TG_ARGV[0]) USING NEW."clientId";
  ELSIF TG_OP = 'DELETE' THEN
    EXECUTE format('UPDATE "Client" SET %I = false WHERE id = $1', TG_ARGV[0]) USING OLD."clientId";
  END IF;
  RETURN NULL;
END $fn$ LANGUAGE plpgsql;

CREATE TRIGGER client_company_flag AFTER INSERT OR DELETE ON "ClientRegistration" FOR EACH ROW EXECUTE FUNCTION crm_addon_flag('hasCompany');
CREATE TRIGGER client_csr_flag     AFTER INSERT OR DELETE ON "ClientCsr"          FOR EACH ROW EXECUTE FUNCTION crm_addon_flag('isCsr');
CREATE TRIGGER client_govt_flag    AFTER INSERT OR DELETE ON "ClientGovt"         FOR EACH ROW EXECUTE FUNCTION crm_addon_flag('isGovt');

-- ── service lines: kept from the client's active SPOCs ─────────────────────────────────────
CREATE OR REPLACE FUNCTION crm_sync_client_service_lines(cid text) RETURNS void AS $fn$
BEGIN
  DELETE FROM "ClientServiceLine" csl
  WHERE csl."clientId" = cid
    AND NOT EXISTS (SELECT 1 FROM "ClientSpoc" s WHERE s."clientId" = cid AND s."isActive" AND s."serviceLineId" = csl."serviceLineId");
  INSERT INTO "ClientServiceLine" ("id","clientId","serviceLineId","createdAt")
  SELECT gen_random_uuid()::text, cid, x.sl, now()
  FROM (SELECT DISTINCT s."serviceLineId" AS sl FROM "ClientSpoc" s WHERE s."clientId" = cid AND s."isActive") x
  ON CONFLICT ("clientId","serviceLineId") DO NOTHING;
END $fn$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION crm_spoc_service_lines() RETURNS trigger AS $fn$
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN PERFORM crm_sync_client_service_lines(OLD."clientId"); END IF;
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW."clientId" IS DISTINCT FROM OLD."clientId") THEN
    PERFORM crm_sync_client_service_lines(NEW."clientId");
  END IF;
  RETURN NULL;
END $fn$ LANGUAGE plpgsql;

CREATE TRIGGER client_spoc_service_lines
AFTER INSERT OR DELETE OR UPDATE OF "serviceLineId", "isActive", "clientId" ON "ClientSpoc"
FOR EACH ROW EXECUTE FUNCTION crm_spoc_service_lines();

-- backfill from today's SPOCs
INSERT INTO "ClientServiceLine" ("id","clientId","serviceLineId","createdAt")
SELECT gen_random_uuid()::text, x."clientId", x."serviceLineId", now()
FROM (SELECT DISTINCT "clientId", "serviceLineId" FROM "ClientSpoc" WHERE "isActive") x
ON CONFLICT ("clientId","serviceLineId") DO NOTHING;
