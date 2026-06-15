-- CreateTable
CREATE TABLE "UserAssignableTo" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "addedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserAssignableTo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserAssignableTo_userId_idx" ON "UserAssignableTo"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserAssignableTo_userId_targetId_key" ON "UserAssignableTo"("userId", "targetId");

-- AddForeignKey
ALTER TABLE "UserAssignableTo" ADD CONSTRAINT "UserAssignableTo_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAssignableTo" ADD CONSTRAINT "UserAssignableTo_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAssignableTo" ADD CONSTRAINT "UserAssignableTo_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
