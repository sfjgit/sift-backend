-- CreateTable
CREATE TABLE "SavedSearch" (
    "id" TEXT NOT NULL,
    "recruiterId" TEXT NOT NULL,
    "requirementId" TEXT,
    "assignmentId" TEXT,
    "name" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedSearch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SearchActivityLog" (
    "id" TEXT NOT NULL,
    "recruiterId" TEXT NOT NULL,
    "requirementId" TEXT,
    "assignmentId" TEXT,
    "filters" JSONB NOT NULL,
    "resultCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SearchActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourcingActivityLog" (
    "id" TEXT NOT NULL,
    "recruiterId" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "candidateServiceId" TEXT NOT NULL,
    "candidateEmail" TEXT,
    "candidateName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourcingActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SavedSearch_recruiterId_idx" ON "SavedSearch"("recruiterId");

-- CreateIndex
CREATE INDEX "SavedSearch_requirementId_idx" ON "SavedSearch"("requirementId");

-- CreateIndex
CREATE INDEX "SearchActivityLog_recruiterId_createdAt_idx" ON "SearchActivityLog"("recruiterId", "createdAt");

-- CreateIndex
CREATE INDEX "SearchActivityLog_requirementId_idx" ON "SearchActivityLog"("requirementId");

-- CreateIndex
CREATE INDEX "SearchActivityLog_createdAt_idx" ON "SearchActivityLog"("createdAt");

-- CreateIndex
CREATE INDEX "SourcingActivityLog_recruiterId_createdAt_idx" ON "SourcingActivityLog"("recruiterId", "createdAt");

-- CreateIndex
CREATE INDEX "SourcingActivityLog_requirementId_idx" ON "SourcingActivityLog"("requirementId");

-- CreateIndex
CREATE INDEX "SourcingActivityLog_createdAt_idx" ON "SourcingActivityLog"("createdAt");

-- AddForeignKey
ALTER TABLE "SavedSearch" ADD CONSTRAINT "SavedSearch_recruiterId_fkey" FOREIGN KEY ("recruiterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SearchActivityLog" ADD CONSTRAINT "SearchActivityLog_recruiterId_fkey" FOREIGN KEY ("recruiterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourcingActivityLog" ADD CONSTRAINT "SourcingActivityLog_recruiterId_fkey" FOREIGN KEY ("recruiterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
