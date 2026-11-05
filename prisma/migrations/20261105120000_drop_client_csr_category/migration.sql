-- Drop the client CSR category (CSR spend band). The CSR figures themselves
-- (ClientCsrFinancial, Client.csrFy / csrSpentRs) stay.

-- DropForeignKey
ALTER TABLE "Client" DROP CONSTRAINT IF EXISTS "Client_csrCategoryId_fkey";

-- DropIndex
DROP INDEX IF EXISTS "Client_csrCategoryId_idx";

-- AlterTable
ALTER TABLE "Client" DROP COLUMN IF EXISTS "csrCategoryId",
DROP COLUMN IF EXISTS "csrCategoryAuto";

-- The band pick-list rows (every tenant). Client was their only user; the
-- other Lookup foreign keys are type-checked by the API, so none should point
-- here — if one does, this fails and the whole migration rolls back.
DELETE FROM "Lookup" WHERE "type" = 'CSR_CATEGORY';
