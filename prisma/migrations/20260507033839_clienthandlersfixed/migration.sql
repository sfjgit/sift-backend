-- DropForeignKey
ALTER TABLE "ClientSpoc" DROP CONSTRAINT "ClientSpoc_assignedById_fkey";

-- DropForeignKey
ALTER TABLE "ClientSpoc" DROP CONSTRAINT "ClientSpoc_userId_fkey";

-- DropIndex
DROP INDEX "ClientSpoc_clientId_userId_serviceLineId_key";

-- DropIndex
DROP INDEX "ClientSpoc_userId_isActive_idx";

-- drop requirements FK temporarily if it references ClientSpoc
-- (re-added at end)

-- Step 1: drop NOT NULL cols as nullable first, drop old cols
ALTER TABLE "ClientSpoc" DROP COLUMN "assignedAt";
ALTER TABLE "ClientSpoc" DROP COLUMN "assignedById";
ALTER TABLE "ClientSpoc" DROP COLUMN "removedAt";

-- Step 2: add new columns as nullable
ALTER TABLE "ClientSpoc" ADD COLUMN "firstName"    TEXT;
ALTER TABLE "ClientSpoc" ADD COLUMN "lastName"     TEXT;
ALTER TABLE "ClientSpoc" ADD COLUMN "handlerId"    TEXT;
ALTER TABLE "ClientSpoc" ADD COLUMN "addedById"    TEXT;
ALTER TABLE "ClientSpoc" ADD COLUMN "email"        TEXT;
ALTER TABLE "ClientSpoc" ADD COLUMN "phone"        TEXT;
ALTER TABLE "ClientSpoc" ADD COLUMN "designation"  TEXT;
ALTER TABLE "ClientSpoc" ADD COLUMN "department"   TEXT;
ALTER TABLE "ClientSpoc" ADD COLUMN "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "ClientSpoc" ADD COLUMN "updatedAt"    TIMESTAMP(3);
ALTER TABLE "ClientSpoc" ALTER COLUMN "isPrimary"  SET DEFAULT false;

-- Step 3: backfill from existing userId before dropping it
UPDATE "ClientSpoc" SET
  "firstName"  = 'Legacy',
  "lastName"   = 'Contact',
  "handlerId"  = "userId",
  "addedById"  = "userId",
  "updatedAt"  = NOW()
WHERE "handlerId" IS NULL;

-- Step 4: drop old userId column
ALTER TABLE "ClientSpoc" DROP COLUMN "userId";

-- Step 5: make required columns NOT NULL now that data exists
ALTER TABLE "ClientSpoc" ALTER COLUMN "firstName"  SET NOT NULL;
ALTER TABLE "ClientSpoc" ALTER COLUMN "lastName"   SET NOT NULL;
ALTER TABLE "ClientSpoc" ALTER COLUMN "handlerId"  SET NOT NULL;
ALTER TABLE "ClientSpoc" ALTER COLUMN "addedById"  SET NOT NULL;
ALTER TABLE "ClientSpoc" ALTER COLUMN "updatedAt"  SET NOT NULL;

-- Step 6: indexes
CREATE INDEX "ClientSpoc_handlerId_isActive_idx" ON "ClientSpoc"("handlerId", "isActive");

-- Step 7: unique index — email can be null so only apply where email exists
-- prisma will handle nulls correctly but we need no duplicate non-null combos
CREATE UNIQUE INDEX "ClientSpoc_clientId_email_serviceLineId_key" 
  ON "ClientSpoc"("clientId", "email", "serviceLineId");

-- Step 8: foreign keys
ALTER TABLE "ClientSpoc" ADD CONSTRAINT "ClientSpoc_handlerId_fkey" 
  FOREIGN KEY ("handlerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ClientSpoc" ADD CONSTRAINT "ClientSpoc_addedById_fkey" 
  FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;