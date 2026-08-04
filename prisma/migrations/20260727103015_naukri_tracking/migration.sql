-- CreateEnum
CREATE TYPE "NaukriPromiseStatus" AS ENUM ('PENDING', 'KEPT', 'BROKEN', 'NONE');

-- CreateEnum
CREATE TYPE "MemeCategory" AS ENUM ('HAPPY', 'CELEBRATE', 'ANGRY', 'SHAME', 'SAD', 'NEUTRAL');

-- CreateEnum
CREATE TYPE "NaukriMsgAuthor" AS ENUM ('SYSTEM', 'RECRUITER', 'MANAGER');

-- CreateTable
CREATE TABLE "NaukriRecruiterDaily" (
    "id" TEXT NOT NULL,
    "reportDate" DATE NOT NULL,
    "recruiterId" TEXT NOT NULL,
    "naukriConsumed" INTEGER,
    "atsCaptured" INTEGER,
    "difference" INTEGER,
    "reason" TEXT,
    "reasonAt" TIMESTAMP(3),
    "promiseMade" BOOLEAN NOT NULL DEFAULT false,
    "promiseText" TEXT,
    "promiseMadeAt" TIMESTAMP(3),
    "promiseStatus" "NaukriPromiseStatus" NOT NULL DEFAULT 'NONE',
    "evaluatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NaukriRecruiterDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NaukriMessage" (
    "id" TEXT NOT NULL,
    "dailyId" TEXT NOT NULL,
    "author" "NaukriMsgAuthor" NOT NULL DEFAULT 'SYSTEM',
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "memeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NaukriMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NaukriRecruiterStreak" (
    "recruiterId" TEXT NOT NULL,
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "longestStreak" INTEGER NOT NULL DEFAULT 0,
    "totalKept" INTEGER NOT NULL DEFAULT 0,
    "totalBroken" INTEGER NOT NULL DEFAULT 0,
    "lastEvaluated" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NaukriRecruiterStreak_pkey" PRIMARY KEY ("recruiterId")
);

-- CreateTable
CREATE TABLE "MemeAsset" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "category" "MemeCategory" NOT NULL,
    "caption" TEXT,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemeAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NaukriRecruiterDaily_recruiterId_idx" ON "NaukriRecruiterDaily"("recruiterId");

-- CreateIndex
CREATE INDEX "NaukriRecruiterDaily_reportDate_idx" ON "NaukriRecruiterDaily"("reportDate");

-- CreateIndex
CREATE INDEX "NaukriRecruiterDaily_promiseStatus_idx" ON "NaukriRecruiterDaily"("promiseStatus");

-- CreateIndex
CREATE UNIQUE INDEX "NaukriRecruiterDaily_reportDate_recruiterId_key" ON "NaukriRecruiterDaily"("reportDate", "recruiterId");

-- CreateIndex
CREATE INDEX "NaukriMessage_dailyId_idx" ON "NaukriMessage"("dailyId");

-- CreateIndex
CREATE INDEX "MemeAsset_category_isActive_idx" ON "MemeAsset"("category", "isActive");

-- AddForeignKey
ALTER TABLE "NaukriMessage" ADD CONSTRAINT "NaukriMessage_dailyId_fkey" FOREIGN KEY ("dailyId") REFERENCES "NaukriRecruiterDaily"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NaukriMessage" ADD CONSTRAINT "NaukriMessage_memeId_fkey" FOREIGN KEY ("memeId") REFERENCES "MemeAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
