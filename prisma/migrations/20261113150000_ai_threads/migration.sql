-- CreateTable
CREATE TABLE "AiThread" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "page" TEXT,
    "spec" JSONB,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiTurn" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "input" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "message" TEXT,
    "options" JSONB,
    "spec" JSONB,
    "tier" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiTurn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiAnswerMemory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "masked" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "answer" JSONB NOT NULL,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiAnswerMemory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiThread_tenantId_userId_updatedAt_idx" ON "AiThread"("tenantId", "userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiTurn_threadId_seq_key" ON "AiTurn"("threadId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "AiAnswerMemory_tenantId_key_key" ON "AiAnswerMemory"("tenantId", "key");

-- AddForeignKey
ALTER TABLE "AiTurn" ADD CONSTRAINT "AiTurn_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "AiThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

