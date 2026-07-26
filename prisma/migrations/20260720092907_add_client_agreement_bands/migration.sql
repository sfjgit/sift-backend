-- CreateEnum
CREATE TYPE "AgreementType" AS ENUM ('BAND', 'FIXED');

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "agreementType" "AgreementType" DEFAULT 'FIXED',
ADD COLUMN     "percentageValue" DECIMAL(65,30);

-- CreateTable
CREATE TABLE "Band" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT,
    "code" TEXT NOT NULL,
    "stringValue" TEXT NOT NULL,
    "rangeFrom" DECIMAL(65,30) NOT NULL,
    "rangeTo" DECIMAL(65,30) NOT NULL,
    "value" DECIMAL(65,30) NOT NULL,
    "experience" DECIMAL(65,30),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Band_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Band_clientId_idx" ON "Band"("clientId");

-- AddForeignKey
ALTER TABLE "Band" ADD CONSTRAINT "Band_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
