-- Clients imported from CASPA (the CSR tool) with no SPOCs yet: BU = CSR, SL = CSR.
UPDATE "Client" SET "businessUnitId" = (SELECT id FROM "BusinessUnit" WHERE code = 'CSR')
WHERE "businessUnitId" IS NULL AND "legacyCaspaId" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "BusinessUnit" WHERE code = 'CSR');

INSERT INTO "ClientServiceLine" ("id", "clientId", "serviceLineId")
SELECT gen_random_uuid()::text, c.id, sl.id
FROM "Client" c CROSS JOIN (SELECT id FROM "ServiceLine" WHERE code = 'CSR') sl
WHERE c."legacyCaspaId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "ClientServiceLine" x WHERE x."clientId" = c.id)
ON CONFLICT ("clientId", "serviceLineId") DO NOTHING;
