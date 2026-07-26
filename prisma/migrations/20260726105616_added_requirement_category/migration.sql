-- AlterTable
ALTER TABLE "Requirement" ADD COLUMN     "requirementCategoryId" TEXT;

-- CreateTable
CREATE TABLE "RequirementCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "order" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RequirementCategory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RequirementCategory_name_key" ON "RequirementCategory"("name");

-- CreateIndex
CREATE UNIQUE INDEX "RequirementCategory_slug_key" ON "RequirementCategory"("slug");

-- CreateIndex
CREATE INDEX "RequirementCategory_isActive_idx" ON "RequirementCategory"("isActive");

-- CreateIndex
CREATE INDEX "Requirement_requirementCategoryId_idx" ON "Requirement"("requirementCategoryId");

-- AddForeignKey
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_requirementCategoryId_fkey" FOREIGN KEY ("requirementCategoryId") REFERENCES "RequirementCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
