-- CreateEnum
CREATE TYPE "TicketEventKind" AS ENUM ('MESSAGE', 'STATUS_CHANGE', 'ASSIGNMENT');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'INTERVIEW_RESCHEDULED';

-- AlterTable
ALTER TABLE "CandidateInterviewSchedule" ALTER COLUMN "roundNumber" DROP NOT NULL,
ALTER COLUMN "scheduledAt" DROP NOT NULL,
ALTER COLUMN "durationMins" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "assignedToName" TEXT,
ADD COLUMN     "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "raisedByName" TEXT;

-- AlterTable
ALTER TABLE "TicketComment" ADD COLUMN     "authorName" TEXT,
ADD COLUMN     "authorRole" TEXT,
ADD COLUMN     "fromStatus" "TicketStatus",
ADD COLUMN     "kind" "TicketEventKind" NOT NULL DEFAULT 'MESSAGE',
ADD COLUMN     "statusAtPost" "TicketStatus" NOT NULL DEFAULT 'OPEN',
ADD COLUMN     "toStatus" "TicketStatus",
ALTER COLUMN "body" DROP NOT NULL;

-- CreateTable
CREATE TABLE "TicketCommentAttachment" (
    "id" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketCommentAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketNotification" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "commentId" TEXT,
    "recipientId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT,
    "kind" "TicketEventKind" NOT NULL,
    "title" TEXT NOT NULL,
    "preview" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TicketCommentAttachment_commentId_idx" ON "TicketCommentAttachment"("commentId");

-- CreateIndex
CREATE INDEX "TicketNotification_recipientId_isRead_createdAt_idx" ON "TicketNotification"("recipientId", "isRead", "createdAt");

-- CreateIndex
CREATE INDEX "TicketNotification_ticketId_idx" ON "TicketNotification"("ticketId");

-- CreateIndex
CREATE INDEX "Ticket_lastActivityAt_idx" ON "Ticket"("lastActivityAt");

-- AddForeignKey
ALTER TABLE "TicketCommentAttachment" ADD CONSTRAINT "TicketCommentAttachment_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "TicketComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketNotification" ADD CONSTRAINT "TicketNotification_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
