-- CSR identity + CSR programmes in the annual-report (CSR Rules annexure) shape.
--  * ClientFinancial -> ClientCsrFinancial, ClientProgram -> ClientCsrProgram (data kept)
--  * programmes: several Schedule VII sectors, filterable state / district locations,
--    spent / unspent-transferred amounts, ongoing / local area / mode, and a shared
--    implementing-agency list (CsrAgency) built from the old free-text implementor
--  * latitude / longitude: within range and both-or-neither, on every location table

-- ── 1. rename the CSR-only tables ───────────────────────────────────────────
ALTER TABLE "ClientFinancial" RENAME TO "ClientCsrFinancial";
ALTER TABLE "ClientCsrFinancial" RENAME CONSTRAINT "ClientFinancial_pkey" TO "ClientCsrFinancial_pkey";
ALTER TABLE "ClientCsrFinancial" RENAME CONSTRAINT "ClientFinancial_clientId_fkey" TO "ClientCsrFinancial_clientId_fkey";
ALTER TABLE "ClientCsrFinancial" RENAME CONSTRAINT "ClientFinancial_sourceRunId_fkey" TO "ClientCsrFinancial_sourceRunId_fkey";
ALTER INDEX "ClientFinancial_clientId_fy_key" RENAME TO "ClientCsrFinancial_clientId_fy_key";

ALTER TABLE "ClientProgram" RENAME TO "ClientCsrProgram";
ALTER TABLE "ClientCsrProgram" RENAME CONSTRAINT "ClientProgram_pkey" TO "ClientCsrProgram_pkey";
ALTER TABLE "ClientCsrProgram" RENAME CONSTRAINT "ClientProgram_clientId_fkey" TO "ClientCsrProgram_clientId_fkey";
ALTER TABLE "ClientCsrProgram" RENAME CONSTRAINT "ClientProgram_sourceRunId_fkey" TO "ClientCsrProgram_sourceRunId_fkey";

-- a person adding / editing / removing a programme
ALTER TYPE "ClientActivityType" ADD VALUE 'PROGRAMS_UPDATED';

-- ── 2. new types and tables ─────────────────────────────────────────────────
CREATE TYPE "CsrImplementationMode" AS ENUM ('DIRECT', 'AGENCY');

CREATE TABLE "CsrAgency" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "registrationNo" TEXT,
    "website" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CsrAgency_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CsrAgency_tenantId_nameKey_key" ON "CsrAgency"("tenantId", "nameKey");
CREATE UNIQUE INDEX "CsrAgency_tenantId_registrationNo_key" ON "CsrAgency"("tenantId", "registrationNo");
ALTER TABLE "CsrAgency" ADD CONSTRAINT "CsrAgency_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ClientCsrProgramSector" (
    "programId" TEXT NOT NULL,
    "sectorId" TEXT NOT NULL,
    CONSTRAINT "ClientCsrProgramSector_pkey" PRIMARY KEY ("programId", "sectorId")
);
CREATE INDEX "ClientCsrProgramSector_sectorId_idx" ON "ClientCsrProgramSector"("sectorId");
ALTER TABLE "ClientCsrProgramSector" ADD CONSTRAINT "ClientCsrProgramSector_programId_fkey" FOREIGN KEY ("programId") REFERENCES "ClientCsrProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientCsrProgramSector" ADD CONSTRAINT "ClientCsrProgramSector_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Lookup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ClientCsrProgramLocation" (
    "id" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "district" TEXT,
    "city" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    CONSTRAINT "ClientCsrProgramLocation_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ClientCsrProgramLocation_programId_idx" ON "ClientCsrProgramLocation"("programId");
CREATE INDEX "ClientCsrProgramLocation_state_district_idx" ON "ClientCsrProgramLocation"("state", "district");
ALTER TABLE "ClientCsrProgramLocation" ADD CONSTRAINT "ClientCsrProgramLocation_programId_fkey" FOREIGN KEY ("programId") REFERENCES "ClientCsrProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ── 3. programme columns ────────────────────────────────────────────────────
ALTER TABLE "ClientCsrProgram" RENAME COLUMN "locations" TO "locationNote";
ALTER TABLE "ClientCsrProgram"
    ADD COLUMN "nameKey" TEXT,
    ADD COLUMN "sectorText" TEXT,
    ADD COLUMN "isOngoing" BOOLEAN,
    ADD COLUMN "duration" TEXT,
    ADD COLUMN "isLocalArea" BOOLEAN,
    ADD COLUMN "spentRs" DECIMAL(16,2),
    ADD COLUMN "unspentTransferredRs" DECIMAL(16,2),
    ADD COLUMN "mode" "CsrImplementationMode",
    ADD COLUMN "agencyId" TEXT,
    ADD COLUMN "isLocked" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "updatedById" TEXT;

-- same rule as csrNameKey() in src/services/csrProgram.service.ts
UPDATE "ClientCsrProgram"
SET "nameKey" = COALESCE(NULLIF(TRIM(REGEXP_REPLACE(LOWER("name"), '[^a-z0-9]+', ' ', 'g')), ''), LOWER(TRIM("name")));

-- the old free-text sector, kept as written
UPDATE "ClientCsrProgram" p SET "sectorText" = l."label"
FROM "Lookup" l WHERE l."id" = p."sectorId";

-- a name written two ways in one year: keep the newest row
DELETE FROM "ClientCsrProgram" p
USING "ClientCsrProgram" q
WHERE p."clientId" = q."clientId" AND p."fy" = q."fy" AND p."nameKey" = q."nameKey"
  AND (p."updatedAt", p."id") < (q."updatedAt", q."id");

ALTER TABLE "ClientCsrProgram" ALTER COLUMN "nameKey" SET NOT NULL;
DROP INDEX "ClientProgram_clientId_fy_name_key";
CREATE UNIQUE INDEX "ClientCsrProgram_clientId_fy_nameKey_key" ON "ClientCsrProgram"("clientId", "fy", "nameKey");
CREATE INDEX "ClientCsrProgram_clientId_nameKey_idx" ON "ClientCsrProgram"("clientId", "nameKey");
CREATE INDEX "ClientCsrProgram_agencyId_idx" ON "ClientCsrProgram"("agencyId");
ALTER TABLE "ClientCsrProgram" ADD CONSTRAINT "ClientCsrProgram_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "CsrAgency"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- one sector -> the sector list
INSERT INTO "ClientCsrProgramSector" ("programId", "sectorId")
SELECT "id", "sectorId" FROM "ClientCsrProgram" WHERE "sectorId" IS NOT NULL;
ALTER TABLE "ClientCsrProgram" DROP CONSTRAINT "ClientProgram_sectorId_fkey";
DROP INDEX "ClientProgram_sectorId_idx";
ALTER TABLE "ClientCsrProgram" DROP COLUMN "sectorId";

-- free-text implementor -> one agency per tenant per normalised name
WITH named AS (
    SELECT c."tenantId", TRIM(p."implementor") AS name,
           COALESCE(NULLIF(TRIM(REGEXP_REPLACE(LOWER(p."implementor"), '[^a-z0-9]+', ' ', 'g')), ''), LOWER(TRIM(p."implementor"))) AS key
    FROM "ClientCsrProgram" p JOIN "Client" c ON c."id" = p."clientId"
    WHERE NULLIF(TRIM(p."implementor"), '') IS NOT NULL
)
INSERT INTO "CsrAgency" ("id", "tenantId", "name", "nameKey", "updatedAt")
SELECT gen_random_uuid()::text, "tenantId", MIN(name), key, CURRENT_TIMESTAMP
FROM named GROUP BY "tenantId", key;

UPDATE "ClientCsrProgram" p
SET "agencyId" = a."id", "mode" = 'AGENCY'
FROM "Client" c, "CsrAgency" a
WHERE c."id" = p."clientId" AND a."tenantId" = c."tenantId"
  AND NULLIF(TRIM(p."implementor"), '') IS NOT NULL
  AND a."nameKey" = COALESCE(NULLIF(TRIM(REGEXP_REPLACE(LOWER(p."implementor"), '[^a-z0-9]+', ' ', 'g')), ''), LOWER(TRIM(p."implementor")));
ALTER TABLE "ClientCsrProgram" DROP COLUMN "implementor";

-- ── 4. Schedule VII sectors for every tenant (existing rows untouched) ──────
INSERT INTO "Lookup" ("id", "tenantId", "type", "code", "label", "order", "isActive", "isSystem", "updatedAt")
SELECT gen_random_uuid()::text, t."id", 'PROGRAM_SECTOR', s.code, s.label, s.ord, true, false, CURRENT_TIMESTAMP
FROM "Tenant" t
CROSS JOIN (VALUES
    ('HEALTH',       'Hunger, poverty, health care, sanitation & drinking water', 1),
    ('EDUCATION',    'Education, vocational skills & livelihood', 2),
    ('GENDER',       'Gender equality, women empowerment & reducing inequalities', 3),
    ('ENVIRONMENT',  'Environment, animal welfare & natural resources', 4),
    ('HERITAGE',     'National heritage, art & culture', 5),
    ('VETERANS',     'Armed forces veterans, war widows & dependants', 6),
    ('SPORTS',       'Sports training & promotion', 7),
    ('RELIEF_FUNDS', 'PM CARES / PM National Relief Fund & similar funds', 8),
    ('RESEARCH',     'Technology incubators & research', 9),
    ('RURAL',        'Rural development', 10),
    ('SLUM',         'Slum area development', 11),
    ('DISASTER',     'Disaster management & relief', 12),
    ('OTHER',        'Other', 99)
) AS s(code, label, ord)
ON CONFLICT ("tenantId", "type", "code") DO NOTHING;

-- ── 5. coordinates: in range, both or neither ───────────────────────────────
-- a half pair or an impossible value can't be placed on a map: clear it first
UPDATE "ClientLocation" SET "latitude" = NULL, "longitude" = NULL
WHERE ("latitude" IS NULL) <> ("longitude" IS NULL)
   OR "latitude" NOT BETWEEN -90 AND 90 OR "longitude" NOT BETWEEN -180 AND 180;
ALTER TABLE "ClientLocation"
    ADD CONSTRAINT "ClientLocation_latitude_range" CHECK ("latitude" BETWEEN -90 AND 90),
    ADD CONSTRAINT "ClientLocation_longitude_range" CHECK ("longitude" BETWEEN -180 AND 180),
    ADD CONSTRAINT "ClientLocation_coords_pair" CHECK (("latitude" IS NULL) = ("longitude" IS NULL));
ALTER TABLE "ClientCsrProgramLocation"
    ADD CONSTRAINT "ClientCsrProgramLocation_latitude_range" CHECK ("latitude" BETWEEN -90 AND 90),
    ADD CONSTRAINT "ClientCsrProgramLocation_longitude_range" CHECK ("longitude" BETWEEN -180 AND 180),
    ADD CONSTRAINT "ClientCsrProgramLocation_coords_pair" CHECK (("latitude" IS NULL) = ("longitude" IS NULL));
