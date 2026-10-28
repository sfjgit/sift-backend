-- trigram indexes make ILIKE '%text%' searches use an index
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- DropIndex
DROP INDEX "OutreachPack_clientId_idx";

-- CreateIndex
CREATE INDEX "Client_deletedAt_createdAt_idx" ON "Client"("deletedAt", "createdAt");

-- CreateIndex
CREATE INDEX "Client_deletedAt_name_idx" ON "Client"("deletedAt", "name");

-- CreateIndex
CREATE INDEX "Client_name_idx" ON "Client" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Client_shortName_idx" ON "Client" USING GIN ("shortName" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Client_cin_idx" ON "Client" USING GIN ("cin" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "ClientAssignment_assignedById_endedAt_idx" ON "ClientAssignment"("assignedById", "endedAt");

-- CreateIndex
CREATE INDEX "ClientLocation_state_idx" ON "ClientLocation" USING GIN ("state" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "ClientLocation_city_idx" ON "ClientLocation" USING GIN ("city" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "ClientSpoc_firstName_idx" ON "ClientSpoc" USING GIN ("firstName" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "ClientSpoc_lastName_idx" ON "ClientSpoc" USING GIN ("lastName" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "ClientSpoc_email_idx" ON "ClientSpoc" USING GIN ("email" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "OutreachPack_clientId_status_idx" ON "OutreachPack"("clientId", "status");

-- CreateIndex
CREATE INDEX "StepRun_clientId_stepId_status_createdAt_idx" ON "StepRun"("clientId", "stepId", "status", "createdAt");

