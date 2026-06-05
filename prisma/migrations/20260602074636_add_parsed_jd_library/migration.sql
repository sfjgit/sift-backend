-- AlterTable
ALTER TABLE "Requirement" ADD COLUMN     "parsedJDId" TEXT;

-- CreateTable
CREATE TABLE "ParsedJDLibrary" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "parsedData" JSONB NOT NULL,
    "jdFileKey" TEXT,
    "jdFileName" TEXT,
    "jdFileType" TEXT,
    "parsedById" TEXT NOT NULL,
    "parsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "usedByIds" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParsedJDLibrary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ParsedJDLibrary_title_idx" ON "ParsedJDLibrary"("title");

-- CreateIndex
CREATE INDEX "ParsedJDLibrary_isActive_idx" ON "ParsedJDLibrary"("isActive");

-- CreateIndex
CREATE INDEX "ParsedJDLibrary_usageCount_idx" ON "ParsedJDLibrary"("usageCount");

-- CreateIndex
CREATE INDEX "ParsedJDLibrary_parsedById_idx" ON "ParsedJDLibrary"("parsedById");

-- CreateIndex
CREATE INDEX "Requirement_parsedJDId_idx" ON "Requirement"("parsedJDId");

-- AddForeignKey
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_parsedJDId_fkey" FOREIGN KEY ("parsedJDId") REFERENCES "ParsedJDLibrary"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParsedJDLibrary" ADD CONSTRAINT "ParsedJDLibrary_parsedById_fkey" FOREIGN KEY ("parsedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
