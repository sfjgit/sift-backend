/*
  Warnings:

  - You are about to drop the column `parentTeamId` on the `Team` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[businessUnitId,name]` on the table `TeamArc` will be added. If there are existing duplicate values, this will fail.
  - Made the column `teamArcId` on table `Team` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "Team" DROP CONSTRAINT "Team_parentTeamId_fkey";

-- DropForeignKey
ALTER TABLE "Team" DROP CONSTRAINT "Team_teamArcId_fkey";

-- DropIndex
DROP INDEX "Team_parentTeamId_idx";

-- AlterTable
ALTER TABLE "Team" DROP COLUMN "parentTeamId",
ALTER COLUMN "teamArcId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "TeamArc_businessUnitId_name_key" ON "TeamArc"("businessUnitId", "name");

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_teamArcId_fkey" FOREIGN KEY ("teamArcId") REFERENCES "TeamArc"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
