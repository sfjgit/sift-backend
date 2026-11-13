-- meetings share the task list (a meeting = a dated task with minutes); tasks get free notes
ALTER TYPE "WorkTaskKind" ADD VALUE 'MEETING';

ALTER TABLE "WorkTask" ADD COLUMN "notes" TEXT;
