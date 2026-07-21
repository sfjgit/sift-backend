/*
  Warnings:

  - You are about to drop the column `stringValue` on the `Band` table. All the data in the column will be lost.
  - Made the column `name` on table `Band` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Band" DROP COLUMN "stringValue",
ALTER COLUMN "name" SET NOT NULL,
ALTER COLUMN "rangeFrom" DROP NOT NULL,
ALTER COLUMN "rangeTo" DROP NOT NULL,
ALTER COLUMN "value" DROP NOT NULL;
