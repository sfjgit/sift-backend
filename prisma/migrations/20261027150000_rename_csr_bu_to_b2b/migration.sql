-- The business unit was created as "CSR"; it is B2B. Rename in place: clients,
-- SPOCs, user memberships and run options point at it by id, so they follow.
-- (The CSR *service line* is correct and stays.)
UPDATE "BusinessUnit" SET "name" = 'B2B', "code" = 'B2B'
WHERE "code" = 'CSR'
  AND NOT EXISTS (SELECT 1 FROM "BusinessUnit" WHERE "code" = 'B2B' OR "name" = 'B2B');
