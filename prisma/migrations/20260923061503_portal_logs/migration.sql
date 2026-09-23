-- CreateTable
CREATE TABLE "PortalRecruitLog" (
    "id" TEXT NOT NULL,
    "recruiterId" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "reqCode" TEXT,
    "appName" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortalRecruitLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PortalRecruitLog_requirementId_recruiterId_appName_idx" ON "PortalRecruitLog"("requirementId", "recruiterId", "appName");

-- CreateIndex
CREATE INDEX "PortalRecruitLog_recruiterId_createdAt_idx" ON "PortalRecruitLog"("recruiterId", "createdAt");

-- AddForeignKey
ALTER TABLE "PortalRecruitLog" ADD CONSTRAINT "PortalRecruitLog_recruiterId_fkey" FOREIGN KEY ("recruiterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
