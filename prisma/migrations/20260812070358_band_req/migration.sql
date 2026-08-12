-- AlterTable
ALTER TABLE "Requirement" ADD COLUMN     "bandId" TEXT,
ADD COLUMN     "saleValue" DOUBLE PRECISION;

-- CreateIndex
CREATE INDEX "Requirement_bandId_idx" ON "Requirement"("bandId");

-- AddForeignKey
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_bandId_fkey" FOREIGN KEY ("bandId") REFERENCES "Band"("id") ON DELETE SET NULL ON UPDATE CASCADE;
