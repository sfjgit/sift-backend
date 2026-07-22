-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CanonicalStage" ADD VALUE 'TRAINING_STARTED';
ALTER TYPE "CanonicalStage" ADD VALUE 'TRAINING_CANCELLED';
ALTER TYPE "CanonicalStage" ADD VALUE 'TRAINING_HOLD';
ALTER TYPE "CanonicalStage" ADD VALUE 'TRAINING_IN_PROGRESS';
ALTER TYPE "CanonicalStage" ADD VALUE 'TRAINING_COMPLETED';
