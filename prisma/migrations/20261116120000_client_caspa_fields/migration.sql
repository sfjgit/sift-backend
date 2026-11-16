-- CASPA client page parity: ICP facts, programme SDGs, section comments (additive)
ALTER TABLE "Client" ADD COLUMN "foundationName" TEXT,
  ADD COLUMN "foundationWebsite" TEXT,
  ADD COLUMN "isListed" BOOLEAN,
  ADD COLUMN "subCategory" TEXT,
  ADD COLUMN "linkedinEmployees" INTEGER,
  ADD COLUMN "marketCapRs" DECIMAL(18,2);

ALTER TABLE "ClientCsrProgram" ADD COLUMN "sdgs" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

ALTER TABLE "ClientNote" ADD COLUMN "section" TEXT;
