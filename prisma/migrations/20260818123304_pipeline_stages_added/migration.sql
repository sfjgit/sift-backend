-- AlterTable
ALTER TABLE "PipelineStage" ADD COLUMN     "isNearTerminal" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isSourced" BOOLEAN NOT NULL DEFAULT false;
