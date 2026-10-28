-- CreateEnum
CREATE TYPE "OutreachStatus" AS ENUM ('DRAFT', 'REVIEWED', 'SENT', 'REPLIED', 'NO_REPLY', 'BOUNCED');

-- AlterEnum
ALTER TYPE "ClientActivityType" ADD VALUE 'OUTREACH_UPDATED';

-- AlterTable
ALTER TABLE "OutreachMessage" ADD COLUMN     "editedAt" TIMESTAMP(3),
ADD COLUMN     "editedById" TEXT,
ADD COLUMN     "sentAt" TIMESTAMP(3),
ADD COLUMN     "sentById" TEXT;

-- AlterTable
ALTER TABLE "OutreachPack" ADD COLUMN     "outcomeNote" TEXT,
ADD COLUMN     "repliedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT,
ADD COLUMN     "status" "OutreachStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "statusAt" TIMESTAMP(3),
ADD COLUMN     "statusById" TEXT;

-- CreateIndex
CREATE INDEX "OutreachPack_status_idx" ON "OutreachPack"("status");

-- AddForeignKey
ALTER TABLE "OutreachPack" ADD CONSTRAINT "OutreachPack_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachPack" ADD CONSTRAINT "OutreachPack_statusById_fkey" FOREIGN KEY ("statusById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachMessage" ADD CONSTRAINT "OutreachMessage_editedById_fkey" FOREIGN KEY ("editedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachMessage" ADD CONSTRAINT "OutreachMessage_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

