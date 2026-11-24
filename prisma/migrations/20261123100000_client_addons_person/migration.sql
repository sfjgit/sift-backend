-- Client add-ons (Registration, CSR, Govt), company group, Person (one human → many client SPOC roles).
-- Additive: the old Client columns stay (read by the deployed build) until the next deploy; data is copied below.

-- CreateEnum
CREATE TYPE "ClientOwnership" AS ENUM ('PRIVATE', 'CENTRAL_GOVT', 'STATE_GOVT');
-- CreateEnum
CREATE TYPE "GovtLevel" AS ENUM ('CENTRAL', 'STATE', 'DISTRICT', 'LOCAL');
-- DropIndex
DROP INDEX "ClientSpoc_tenantId_email_key";
-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "groupName" TEXT;
-- AlterTable
ALTER TABLE "ClientSpoc" ADD COLUMN     "personId" TEXT;
-- CreateTable
CREATE TABLE "ClientRegistration" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "cin" TEXT,
    "ownership" "ClientOwnership",
    "companyClass" TEXT,
    "yearOfIncorporation" INTEGER,
    "isListed" BOOLEAN,
    "marketCapRs" DECIMAL(18,2),
    "subCategory" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ClientRegistration_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "ClientCsr" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "csrRoleId" TEXT,
    "csrEligible" BOOLEAN,
    "foundationName" TEXT,
    "foundationWebsite" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ClientCsr_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "ClientGovt" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "level" "GovtLevel",
    "orgTypeId" TEXT,
    "parentClientId" TEXT,
    "nodalMinistryId" TEXT,
    "ministryName" TEXT,
    "departmentName" TEXT,
    "stateSkillBody" TEXT,
    "sector" TEXT,
    "skillFamily" TEXT,
    "isNational" BOOLEAN,
    "schemeType" TEXT,
    "estimatedBudget" TEXT,
    "tenderPortal" TEXT,
    "tenderAuthority" TEXT,
    "priority" TEXT,
    "digitalMaturity" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ClientGovt_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "Person" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT,
    "nameKey" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "linkedinUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "ClientRegistration_clientId_key" ON "ClientRegistration"("clientId");
-- CreateIndex
CREATE INDEX "ClientRegistration_cin_idx" ON "ClientRegistration" USING GIN ("cin" gin_trgm_ops);
-- CreateIndex
CREATE UNIQUE INDEX "ClientRegistration_tenantId_cin_key" ON "ClientRegistration"("tenantId", "cin");
-- CreateIndex
CREATE UNIQUE INDEX "ClientCsr_clientId_key" ON "ClientCsr"("clientId");
-- CreateIndex
CREATE INDEX "ClientCsr_csrRoleId_idx" ON "ClientCsr"("csrRoleId");
-- CreateIndex
CREATE INDEX "ClientCsr_csrEligible_idx" ON "ClientCsr"("csrEligible");
-- CreateIndex
CREATE UNIQUE INDEX "ClientGovt_clientId_key" ON "ClientGovt"("clientId");
-- CreateIndex
CREATE INDEX "ClientGovt_level_idx" ON "ClientGovt"("level");
-- CreateIndex
CREATE INDEX "ClientGovt_orgTypeId_idx" ON "ClientGovt"("orgTypeId");
-- CreateIndex
CREATE INDEX "ClientGovt_parentClientId_idx" ON "ClientGovt"("parentClientId");
-- CreateIndex
CREATE INDEX "ClientGovt_nodalMinistryId_idx" ON "ClientGovt"("nodalMinistryId");
-- CreateIndex
CREATE INDEX "Person_tenantId_nameKey_idx" ON "Person"("tenantId", "nameKey");
-- CreateIndex
CREATE UNIQUE INDEX "Person_tenantId_email_key" ON "Person"("tenantId", "email");
-- CreateIndex
CREATE INDEX "Client_tenantId_groupName_idx" ON "Client"("tenantId", "groupName");
-- CreateIndex
CREATE INDEX "ClientSpoc_tenantId_email_idx" ON "ClientSpoc"("tenantId", "email");
-- CreateIndex
CREATE INDEX "ClientSpoc_personId_idx" ON "ClientSpoc"("personId");
-- AddForeignKey
ALTER TABLE "ClientSpoc" ADD CONSTRAINT "ClientSpoc_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ClientRegistration" ADD CONSTRAINT "ClientRegistration_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ClientCsr" ADD CONSTRAINT "ClientCsr_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ClientCsr" ADD CONSTRAINT "ClientCsr_csrRoleId_fkey" FOREIGN KEY ("csrRoleId") REFERENCES "Lookup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ClientGovt" ADD CONSTRAINT "ClientGovt_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ClientGovt" ADD CONSTRAINT "ClientGovt_orgTypeId_fkey" FOREIGN KEY ("orgTypeId") REFERENCES "Lookup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ClientGovt" ADD CONSTRAINT "ClientGovt_parentClientId_fkey" FOREIGN KEY ("parentClientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ClientGovt" ADD CONSTRAINT "ClientGovt_nodalMinistryId_fkey" FOREIGN KEY ("nodalMinistryId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── copy today's company + CSR values into the add-ons ──────────────────────
INSERT INTO "ClientRegistration" ("id","tenantId","clientId","cin","ownership","yearOfIncorporation","isListed","marketCapRs","subCategory","createdAt","updatedAt")
SELECT gen_random_uuid()::text, c."tenantId", c."id", NULLIF(trim(c."cin"), ''),
       CASE WHEN c."cin" ~ '^[LU][0-9]{5}[A-Z]{2}[0-9]{4}GOI[0-9]{6}$' THEN 'CENTRAL_GOVT'::"ClientOwnership"
            WHEN c."cin" ~ '^[LU][0-9]{5}[A-Z]{2}[0-9]{4}SGC[0-9]{6}$' THEN 'STATE_GOVT'::"ClientOwnership"
            WHEN c."cin" ~ '^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$' THEN 'PRIVATE'::"ClientOwnership" END,
       CASE WHEN c."cin" ~ '^[LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}$' THEN substr(c."cin", 9, 4)::int END,
       c."isListed", c."marketCapRs", c."subCategory", now(), now()
FROM "Client" c
WHERE NULLIF(trim(c."cin"), '') IS NOT NULL OR c."isListed" IS NOT NULL OR c."marketCapRs" IS NOT NULL OR c."subCategory" IS NOT NULL;

INSERT INTO "ClientCsr" ("id","clientId","csrEligible","foundationName","foundationWebsite","createdAt","updatedAt")
SELECT gen_random_uuid()::text, c."id", c."csrEligible", c."foundationName", c."foundationWebsite", now(), now()
FROM "Client" c
WHERE c."csrEligible" IS NOT NULL OR c."foundationName" IS NOT NULL OR c."foundationWebsite" IS NOT NULL;
