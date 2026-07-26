-- CreateTable
CREATE TABLE "CandidateIndex" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "currentTitle" TEXT,
    "currentCompany" TEXT,
    "totalExpYears" DOUBLE PRECISION,
    "topSkills" TEXT[],
    "normalizedSkills" TEXT[],
    "locationCity" TEXT,
    "locationState" TEXT,
    "isImmediateJoiner" BOOLEAN NOT NULL DEFAULT false,
    "noticePeriodDays" INTEGER,
    "source" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isBlocked" BOOLEAN NOT NULL DEFAULT false,
    "doNotContact" BOOLEAN NOT NULL DEFAULT false,
    "resumeUrl" TEXT,
    "lastActivityAt" TIMESTAMP(3) NOT NULL,
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CandidateIndex_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CandidateIndex_email_key" ON "CandidateIndex"("email");

-- CreateIndex
CREATE INDEX "CandidateIndex_normalizedSkills_idx" ON "CandidateIndex" USING GIN ("normalizedSkills");

-- CreateIndex
CREATE INDEX "CandidateIndex_topSkills_idx" ON "CandidateIndex" USING GIN ("topSkills");

-- CreateIndex
CREATE INDEX "CandidateIndex_source_idx" ON "CandidateIndex"("source");

-- CreateIndex
CREATE INDEX "CandidateIndex_isActive_isBlocked_idx" ON "CandidateIndex"("isActive", "isBlocked");

-- CreateIndex
CREATE INDEX "CandidateIndex_doNotContact_idx" ON "CandidateIndex"("doNotContact");

-- CreateIndex
CREATE INDEX "CandidateIndex_isImmediateJoiner_idx" ON "CandidateIndex"("isImmediateJoiner");

-- CreateIndex
CREATE INDEX "CandidateIndex_totalExpYears_idx" ON "CandidateIndex"("totalExpYears");

-- CreateIndex
CREATE INDEX "CandidateIndex_lastActivityAt_idx" ON "CandidateIndex"("lastActivityAt");

-- CreateIndex
CREATE INDEX "CandidateIndex_createdAt_idx" ON "CandidateIndex"("createdAt");
