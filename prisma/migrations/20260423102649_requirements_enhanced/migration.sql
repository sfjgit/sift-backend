-- AlterTable
ALTER TABLE "Requirement" ADD COLUMN     "experienceMax" DOUBLE PRECISION,
ADD COLUMN     "experienceMin" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "RequirementJD" (
    "id" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileSizeBytes" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isLatest" BOOLEAN NOT NULL DEFAULT true,
    "extractedText" TEXT,
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequirementJD_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequirementSkill" (
    "id" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "skill" TEXT NOT NULL,
    "isMandatory" BOOLEAN NOT NULL DEFAULT true,
    "experience" DOUBLE PRECISION,

    CONSTRAINT "RequirementSkill_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RequirementJD_requirementId_isLatest_idx" ON "RequirementJD"("requirementId", "isLatest");

-- CreateIndex
CREATE INDEX "RequirementSkill_requirementId_idx" ON "RequirementSkill"("requirementId");

-- AddForeignKey
ALTER TABLE "RequirementJD" ADD CONSTRAINT "RequirementJD_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementJD" ADD CONSTRAINT "RequirementJD_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementSkill" ADD CONSTRAINT "RequirementSkill_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "Requirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
