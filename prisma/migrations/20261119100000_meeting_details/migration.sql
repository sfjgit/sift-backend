-- CreateTable
CREATE TABLE "MeetingDetail" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "mode" TEXT,
    "link" TEXT,
    "revenueGenerated" TEXT,
    "attendeeCount" INTEGER,
    "sfjAttendeeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "clientAttendeeNames" TEXT,
    "clientAttendeeEmails" TEXT,
    "minutes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "meetingStatus" TEXT,
    "approvalStatus" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "proposalStatus" TEXT,
    "proposalDate" DATE,
    "proposalAmountRs" DECIMAL(16,2),
    "tentativeDate" DATE,
    "salesUserId" TEXT,
    "category" TEXT,
    "notes" TEXT,
    "mouShared" BOOLEAN,
    "creditSignedDate" DATE,
    "mouStartDate" DATE,
    "mouEndDate" DATE,
    "semesters" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "credits" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "studentCount" INTEGER,
    "courses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "visitAddress" TEXT,
    "visitPincode" TEXT,
    "visitLat" DECIMAL(9,6),
    "visitLng" DECIMAL(9,6),
    "visitAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeetingDetail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeetingFile" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeetingFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MeetingDetail_taskId_key" ON "MeetingDetail"("taskId");

-- CreateIndex
CREATE INDEX "MeetingDetail_approvalStatus_idx" ON "MeetingDetail"("approvalStatus");

-- CreateIndex
CREATE INDEX "MeetingFile_meetingId_idx" ON "MeetingFile"("meetingId");

-- AddForeignKey
ALTER TABLE "MeetingDetail" ADD CONSTRAINT "MeetingDetail_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "WorkTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingDetail" ADD CONSTRAINT "MeetingDetail_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingDetail" ADD CONSTRAINT "MeetingDetail_salesUserId_fkey" FOREIGN KEY ("salesUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingFile" ADD CONSTRAINT "MeetingFile_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "MeetingDetail"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeetingFile" ADD CONSTRAINT "MeetingFile_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

