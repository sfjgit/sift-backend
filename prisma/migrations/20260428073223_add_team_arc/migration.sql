-- AlterTable
ALTER TABLE "Team" ADD COLUMN     "teamArcId" TEXT;

-- CreateTable
CREATE TABLE "TeamArc" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "businessUnitId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamArc_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeamArc_businessUnitId_idx" ON "TeamArc"("businessUnitId");

-- CreateIndex
CREATE INDEX "TeamArc_isActive_idx" ON "TeamArc"("isActive");

-- CreateIndex
CREATE INDEX "Team_teamArcId_idx" ON "Team"("teamArcId");

-- AddForeignKey
ALTER TABLE "TeamArc" ADD CONSTRAINT "TeamArc_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "BusinessUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_teamArcId_fkey" FOREIGN KEY ("teamArcId") REFERENCES "TeamArc"("id") ON DELETE SET NULL ON UPDATE CASCADE;
