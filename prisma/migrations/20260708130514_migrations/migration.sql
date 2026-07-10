-- CreateEnum
CREATE TYPE "MigrationStagingType" AS ENUM ('UNMAPPED_CREATOR', 'UNMAPPED_RECRUITER', 'UNRESOLVED_CHAIN', 'CLIENT_SPOC_NEEDS_REVIEW', 'DUPLICATE_REQ_CODE');

-- CreateEnum
CREATE TYPE "MigrationStagingStatus" AS ENUM ('PENDING', 'RESOLVED', 'IGNORED');

-- CreateTable
CREATE TABLE "MigrationStaging" (
    "id" TEXT NOT NULL,
    "type" "MigrationStagingType" NOT NULL,
    "reason" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "sourceRow" INTEGER,
    "status" "MigrationStagingStatus" NOT NULL DEFAULT 'PENDING',
    "resolvedUserId" TEXT,
    "resolvedNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MigrationStaging_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MigrationStaging_type_status_idx" ON "MigrationStaging"("type", "status");

-- CreateIndex
CREATE INDEX "MigrationStaging_sourceRow_idx" ON "MigrationStaging"("sourceRow");
