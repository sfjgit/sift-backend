-- AlterTable
ALTER TABLE "User" ADD COLUMN     "buId" TEXT,
ADD COLUMN     "servicelineId" TEXT;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_buId_fkey" FOREIGN KEY ("buId") REFERENCES "BusinessUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_servicelineId_fkey" FOREIGN KEY ("servicelineId") REFERENCES "ServiceLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
