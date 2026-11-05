-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "csrCategoryAuto" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "csrCategoryId" TEXT;

-- CreateIndex
CREATE INDEX "Client_csrCategoryId_idx" ON "Client"("csrCategoryId");

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_csrCategoryId_fkey" FOREIGN KEY ("csrCategoryId") REFERENCES "Lookup"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- CSR spend bands, ₹ crore per year (admin-editable under Pick-lists).
-- meta.minCr / maxCr let the CRM set a client's band from its CSR figures.
INSERT INTO "Lookup" ("id", "type", "code", "label", "order", "isActive", "isSystem", "meta", "updatedAt") VALUES
  (gen_random_uuid(), 'CSR_CATEGORY', 'CR_0_1',       '0–1 cr',       1,  true, false, '{"minCr":0,"maxCr":1}',      now()),
  (gen_random_uuid(), 'CSR_CATEGORY', 'CR_1_5',       '1–5 cr',       2,  true, false, '{"minCr":1,"maxCr":5}',      now()),
  (gen_random_uuid(), 'CSR_CATEGORY', 'CR_5_10',      '5–10 cr',      3,  true, false, '{"minCr":5,"maxCr":10}',     now()),
  (gen_random_uuid(), 'CSR_CATEGORY', 'CR_10_15',     '10–15 cr',     4,  true, false, '{"minCr":10,"maxCr":15}',    now()),
  (gen_random_uuid(), 'CSR_CATEGORY', 'CR_15_25',     '15–25 cr',     5,  true, false, '{"minCr":15,"maxCr":25}',    now()),
  (gen_random_uuid(), 'CSR_CATEGORY', 'CR_25_50',     '25–50 cr',     6,  true, false, '{"minCr":25,"maxCr":50}',    now()),
  (gen_random_uuid(), 'CSR_CATEGORY', 'CR_50_100',    '50–100 cr',    7,  true, false, '{"minCr":50,"maxCr":100}',   now()),
  (gen_random_uuid(), 'CSR_CATEGORY', 'CR_100_200',   '100–200 cr',   8,  true, false, '{"minCr":100,"maxCr":200}',  now()),
  (gen_random_uuid(), 'CSR_CATEGORY', 'CR_200_500',   '200–500 cr',   9,  true, false, '{"minCr":200,"maxCr":500}',  now()),
  (gen_random_uuid(), 'CSR_CATEGORY', 'CR_500_1000',  '500–1,000 cr', 10, true, false, '{"minCr":500,"maxCr":1000}', now()),
  (gen_random_uuid(), 'CSR_CATEGORY', 'CR_1000_PLUS', '> 1,000 cr',   11, true, false, '{"minCr":1000,"maxCr":null}', now())
ON CONFLICT ("type", "code") DO NOTHING;
