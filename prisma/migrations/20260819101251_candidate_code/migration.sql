/*
  Warnings:

  - A unique constraint covering the columns `[candidateCode]` on the table `CandidateSnapshot` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "CandidateSnapshot" ADD COLUMN     "candidateCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "CandidateSnapshot_candidateCode_key" ON "CandidateSnapshot"("candidateCode");
