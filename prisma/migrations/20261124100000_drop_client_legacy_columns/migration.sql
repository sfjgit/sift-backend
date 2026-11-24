-- Finish the 23 Nov restructure (deployed 24 Nov): the add-ons are the only home now.
--   CIN / listing / market cap / sub-category → ClientRegistration; CSR eligible / foundation → ClientCsr.
--   ClientServiceLine: a client's service lines are its active SPOCs' lines (derived), the table is unused.
-- Checked before dropping: no value existed only in these columns. Backup: data-import/backups/2026-11-24-before-drop-legacy-columns/

-- DropForeignKey
ALTER TABLE "ClientServiceLine" DROP CONSTRAINT "ClientServiceLine_clientId_fkey";

-- DropForeignKey
ALTER TABLE "ClientServiceLine" DROP CONSTRAINT "ClientServiceLine_serviceLineId_fkey";

-- DropIndex
DROP INDEX "Client_cin_idx";

-- DropIndex
DROP INDEX "Client_tenantId_cin_key";

-- AlterTable
ALTER TABLE "Client" DROP COLUMN "cin",
DROP COLUMN "csrEligible",
DROP COLUMN "foundationName",
DROP COLUMN "foundationWebsite",
DROP COLUMN "isListed",
DROP COLUMN "marketCapRs",
DROP COLUMN "subCategory";

-- DropTable
DROP TABLE "ClientServiceLine";

