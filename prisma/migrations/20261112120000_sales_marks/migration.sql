-- CreateEnum
CREATE TYPE "SpocDataFlag" AS ENUM ('CONTACT_WRONG', 'EMAIL_WRONG', 'BOTH_WRONG');

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "csrEligible" BOOLEAN,
ADD COLUMN     "projectIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "projectSetAt" TIMESTAMP(3),
ADD COLUMN     "projectSetById" TEXT;

-- AlterTable
ALTER TABLE "ClientSpoc" ADD COLUMN     "dataFlag" "SpocDataFlag",
ADD COLUMN     "dataFlagAt" TIMESTAMP(3),
ADD COLUMN     "dataFlagById" TEXT,
ADD COLUMN     "erp" TEXT,
ADD COLUMN     "keyAccountUserId" TEXT,
ADD COLUMN     "projectIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "projectSetAt" TIMESTAMP(3),
ADD COLUMN     "projectSetById" TEXT;

-- CreateTable
CREATE TABLE "ClientKeyAccount" (
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientKeyAccount_pkey" PRIMARY KEY ("clientId","userId")
);

-- CreateIndex
CREATE INDEX "ClientKeyAccount_userId_idx" ON "ClientKeyAccount"("userId");

-- CreateIndex
CREATE INDEX "ClientSpoc_dataFlag_idx" ON "ClientSpoc"("dataFlag");

-- CreateIndex
CREATE INDEX "ClientSpoc_keyAccountUserId_idx" ON "ClientSpoc"("keyAccountUserId");

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_projectSetById_fkey" FOREIGN KEY ("projectSetById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientKeyAccount" ADD CONSTRAINT "ClientKeyAccount_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientKeyAccount" ADD CONSTRAINT "ClientKeyAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientSpoc" ADD CONSTRAINT "ClientSpoc_dataFlagById_fkey" FOREIGN KEY ("dataFlagById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientSpoc" ADD CONSTRAINT "ClientSpoc_keyAccountUserId_fkey" FOREIGN KEY ("keyAccountUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientSpoc" ADD CONSTRAINT "ClientSpoc_projectSetById_fkey" FOREIGN KEY ("projectSetById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

