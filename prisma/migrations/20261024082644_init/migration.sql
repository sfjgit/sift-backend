-- CreateEnum
CREATE TYPE "PermissionScope" AS ENUM ('OWN', 'TEAM', 'REPORTING', 'REPORTING_LINE', 'DEPARTMENT', 'BU', 'ALL');

-- CreateEnum
CREATE TYPE "ClientStatus" AS ENUM ('PENDING', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "AuthLogType" AS ENUM ('LOGIN', 'LOGOUT', 'REFRESH', 'PASSWORD_RESET', 'PASSWORD_CHANGE', 'ACCOUNT_CREATED', 'ACCOUNT_DEACTIVATED', 'ACCOUNT_REACTIVATED', 'FAILED_LOGIN');

-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('UNVERIFIED', 'GOOD', 'RISKY', 'BAD');

-- CreateEnum
CREATE TYPE "ValidationBand" AS ENUM ('READY', 'REVIEW', 'NOT_USABLE');

-- CreateEnum
CREATE TYPE "StepTarget" AS ENUM ('CLIENT', 'SPOC');

-- CreateEnum
CREATE TYPE "StepRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'EMPTY', 'FAILED', 'STOPPED', 'DISPATCH_FAILED', 'TIMED_OUT');

-- CreateEnum
CREATE TYPE "ClientActivityType" AS ENUM ('CLIENT_CREATED', 'CLIENT_UPDATED', 'CLIENT_APPROVED', 'SPOC_ADDED', 'SPOC_UPDATED', 'SPOC_REASSIGNED', 'NOTE_ADDED', 'DOCUMENT_ADDED', 'FINANCIALS_UPDATED', 'PROGRAMS_ADDED', 'OUTREACH_GENERATED', 'STEP_RUN_STARTED', 'STEP_RUN_FINISHED', 'STEP_RUN_FAILED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('SPOC_ASSIGNED', 'NOTE_ADDED', 'STEP_RUN_FINISHED', 'STEP_RUN_FAILED');

-- CreateEnum
CREATE TYPE "NotificationReferenceType" AS ENUM ('CLIENT', 'SPOC', 'STEP_RUN');

-- CreateTable
CREATE TABLE "Lookup" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "order" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lookup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessUnit" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "parentBUId" TEXT,
    "ancestorIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceLine" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessUnitServiceLine" (
    "id" TEXT NOT NULL,
    "businessUnitId" TEXT NOT NULL,
    "serviceLineId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessUnitServiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Designation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Designation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "resetPasswordToken" TEXT,
    "resetPasswordExpires" TIMESTAMP(3),
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "middleName" TEXT,
    "displayName" TEXT,
    "employeeId" TEXT,
    "phone" TEXT,
    "workingLocation" TEXT,
    "timezone" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "dateOfJoin" TIMESTAMP(3),
    "isSuperAdmin" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "roleId" TEXT NOT NULL,
    "departmentId" TEXT,
    "designationId" TEXT,
    "reportingToId" TEXT,
    "teamLeadId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserBusinessUnit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "businessUnitId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserBusinessUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserServiceLine" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "serviceLineId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserServiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthLogs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "type" "AuthLogType" NOT NULL DEFAULT 'LOGIN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthLogs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImpersonationLog" (
    "id" TEXT NOT NULL,
    "impersonatorId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "reason" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "ImpersonationLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "permissionKey" TEXT NOT NULL,
    "scope" "PermissionScope" NOT NULL DEFAULT 'OWN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT,
    "cin" TEXT,
    "website" TEXT,
    "linkedinUrl" TEXT,
    "country" TEXT,
    "state" TEXT,
    "district" TEXT,
    "city" TEXT,
    "pincode" TEXT,
    "address" TEXT,
    "status" "ClientStatus" NOT NULL DEFAULT 'PENDING',
    "industryId" TEXT,
    "categoryId" TEXT,
    "parentClientId" TEXT,
    "legacyCaspaId" INTEGER,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientSpoc" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT,
    "nameKey" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "designation" TEXT,
    "department" TEXT,
    "linkedinUrl" TEXT,
    "seniority" TEXT,
    "totalExpYears" DECIMAL(4,1),
    "currentOrgExpYears" DECIMAL(4,1),
    "handlerId" TEXT NOT NULL,
    "businessUnitId" TEXT NOT NULL,
    "serviceLineId" TEXT NOT NULL,
    "sourceId" TEXT,
    "emailSourceId" TEXT,
    "salesStatusId" TEXT,
    "emailStatus" "EmailStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "validationScore" INTEGER,
    "validationBand" "ValidationBand",
    "validationChecks" JSONB,
    "validatedAt" TIMESTAMP(3),
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "legacyCaspaId" INTEGER,
    "sourceRunId" TEXT,
    "addedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientSpoc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientSpocAssignment" (
    "id" TEXT NOT NULL,
    "spocId" TEXT NOT NULL,
    "assignedToId" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "reason" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "ClientSpocAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientNote" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientActivity" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "spocId" TEXT,
    "actorId" TEXT,
    "type" "ClientActivityType" NOT NULL,
    "summary" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientDocument" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "fy" TEXT NOT NULL,
    "fileKey" TEXT NOT NULL,
    "fileName" TEXT,
    "sourceUrl" TEXT,
    "sha256" TEXT,
    "sourceRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientFinancial" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "fy" TEXT NOT NULL,
    "obligationRs" DECIMAL(16,2),
    "budgetRs" DECIMAL(16,2),
    "spentRs" DECIMAL(16,2),
    "unspentRs" DECIMAL(16,2),
    "evidence" TEXT,
    "confidence" DECIMAL(3,2),
    "isLocked" BOOLEAN NOT NULL DEFAULT false,
    "sourceRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientFinancial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientProgram" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "fy" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sectorId" TEXT,
    "budgetRs" DECIMAL(16,2),
    "locations" TEXT,
    "beneficiaries" TEXT,
    "implementor" TEXT,
    "sourceUrl" TEXT,
    "sourceRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientProgram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutreachPack" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "spocId" TEXT NOT NULL,
    "fileKey" TEXT,
    "model" TEXT,
    "sourceRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutreachPack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutreachMessage" (
    "id" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "sequenceNo" INTEGER NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,

    CONSTRAINT "OutreachMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalService" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT,
    "outboundKeyEnv" TEXT,
    "inboundKeyHash" TEXT,
    "scopes" TEXT[],
    "timeoutMins" INTEGER NOT NULL DEFAULT 120,
    "maxDispatchTries" INTEGER NOT NULL DEFAULT 5,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastUsedAt" TIMESTAMP(3),
    "lastHealthAt" TIMESTAMP(3),
    "lastHealthOk" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PipelineStep" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "target" "StepTarget" NOT NULL,
    "uiOrder" INTEGER,
    "userClientLimit" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PipelineStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StepRun" (
    "id" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "externalJobId" TEXT,
    "parentRunId" TEXT,
    "clientId" TEXT NOT NULL,
    "spocId" TEXT,
    "requestedById" TEXT NOT NULL,
    "options" JSONB,
    "status" "StepRunStatus" NOT NULL DEFAULT 'QUEUED',
    "progress" INTEGER,
    "note" TEXT,
    "dispatchTries" INTEGER NOT NULL DEFAULT 0,
    "viewData" JSONB,
    "resultSummary" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "howToContinue" TEXT,
    "costUsd" DECIMAL(10,4),
    "credits" JSONB,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "lastCallbackAt" TIMESTAMP(3),
    "nextCheckAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StepRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StepRunEvent" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "fromStatus" "StepRunStatus",
    "toStatus" "StepRunStatus",
    "message" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StepRunEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "referenceId" TEXT NOT NULL,
    "referenceType" "NotificationReferenceType" NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "oldData" JSONB,
    "newData" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Lookup_type_isActive_idx" ON "Lookup"("type", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Lookup_type_code_key" ON "Lookup"("type", "code");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessUnit_name_key" ON "BusinessUnit"("name");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessUnit_code_key" ON "BusinessUnit"("code");

-- CreateIndex
CREATE INDEX "BusinessUnit_isActive_idx" ON "BusinessUnit"("isActive");

-- CreateIndex
CREATE INDEX "BusinessUnit_parentBUId_idx" ON "BusinessUnit"("parentBUId");

-- CreateIndex
CREATE INDEX "BusinessUnit_ancestorIds_idx" ON "BusinessUnit" USING GIN ("ancestorIds");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceLine_name_key" ON "ServiceLine"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceLine_code_key" ON "ServiceLine"("code");

-- CreateIndex
CREATE INDEX "ServiceLine_isActive_idx" ON "ServiceLine"("isActive");

-- CreateIndex
CREATE INDEX "BusinessUnitServiceLine_serviceLineId_idx" ON "BusinessUnitServiceLine"("serviceLineId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessUnitServiceLine_businessUnitId_serviceLineId_key" ON "BusinessUnitServiceLine"("businessUnitId", "serviceLineId");

-- CreateIndex
CREATE UNIQUE INDEX "Department_name_key" ON "Department"("name");

-- CreateIndex
CREATE INDEX "Department_isActive_idx" ON "Department"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Designation_name_key" ON "Designation"("name");

-- CreateIndex
CREATE INDEX "Designation_isActive_idx" ON "Designation"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_employeeId_key" ON "User"("employeeId");

-- CreateIndex
CREATE INDEX "User_isActive_idx" ON "User"("isActive");

-- CreateIndex
CREATE INDEX "User_roleId_idx" ON "User"("roleId");

-- CreateIndex
CREATE INDEX "User_departmentId_idx" ON "User"("departmentId");

-- CreateIndex
CREATE INDEX "User_designationId_idx" ON "User"("designationId");

-- CreateIndex
CREATE INDEX "User_reportingToId_idx" ON "User"("reportingToId");

-- CreateIndex
CREATE INDEX "User_teamLeadId_idx" ON "User"("teamLeadId");

-- CreateIndex
CREATE INDEX "UserBusinessUnit_businessUnitId_idx" ON "UserBusinessUnit"("businessUnitId");

-- CreateIndex
CREATE UNIQUE INDEX "UserBusinessUnit_userId_businessUnitId_key" ON "UserBusinessUnit"("userId", "businessUnitId");

-- CreateIndex
CREATE INDEX "UserServiceLine_serviceLineId_idx" ON "UserServiceLine"("serviceLineId");

-- CreateIndex
CREATE UNIQUE INDEX "UserServiceLine_userId_serviceLineId_key" ON "UserServiceLine"("userId", "serviceLineId");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_token_key" ON "RefreshToken"("token");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "AuthLogs_userId_createdAt_idx" ON "AuthLogs"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuthLogs_type_idx" ON "AuthLogs"("type");

-- CreateIndex
CREATE INDEX "ImpersonationLog_impersonatorId_idx" ON "ImpersonationLog"("impersonatorId");

-- CreateIndex
CREATE INDEX "ImpersonationLog_targetUserId_idx" ON "ImpersonationLog"("targetUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "Role"("name");

-- CreateIndex
CREATE INDEX "RolePermission_permissionKey_idx" ON "RolePermission"("permissionKey");

-- CreateIndex
CREATE UNIQUE INDEX "RolePermission_roleId_permissionKey_key" ON "RolePermission"("roleId", "permissionKey");

-- CreateIndex
CREATE UNIQUE INDEX "Client_cin_key" ON "Client"("cin");

-- CreateIndex
CREATE UNIQUE INDEX "Client_legacyCaspaId_key" ON "Client"("legacyCaspaId");

-- CreateIndex
CREATE INDEX "Client_status_idx" ON "Client"("status");

-- CreateIndex
CREATE INDEX "Client_industryId_idx" ON "Client"("industryId");

-- CreateIndex
CREATE INDEX "Client_categoryId_idx" ON "Client"("categoryId");

-- CreateIndex
CREATE INDEX "Client_parentClientId_idx" ON "Client"("parentClientId");

-- CreateIndex
CREATE INDEX "Client_createdById_idx" ON "Client"("createdById");

-- CreateIndex
CREATE INDEX "Client_deletedAt_idx" ON "Client"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ClientSpoc_email_key" ON "ClientSpoc"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ClientSpoc_legacyCaspaId_key" ON "ClientSpoc"("legacyCaspaId");

-- CreateIndex
CREATE INDEX "ClientSpoc_clientId_isActive_idx" ON "ClientSpoc"("clientId", "isActive");

-- CreateIndex
CREATE INDEX "ClientSpoc_clientId_nameKey_idx" ON "ClientSpoc"("clientId", "nameKey");

-- CreateIndex
CREATE INDEX "ClientSpoc_handlerId_isActive_idx" ON "ClientSpoc"("handlerId", "isActive");

-- CreateIndex
CREATE INDEX "ClientSpoc_businessUnitId_idx" ON "ClientSpoc"("businessUnitId");

-- CreateIndex
CREATE INDEX "ClientSpoc_serviceLineId_idx" ON "ClientSpoc"("serviceLineId");

-- CreateIndex
CREATE INDEX "ClientSpoc_salesStatusId_idx" ON "ClientSpoc"("salesStatusId");

-- CreateIndex
CREATE INDEX "ClientSpoc_validationBand_idx" ON "ClientSpoc"("validationBand");

-- CreateIndex
CREATE INDEX "ClientSpocAssignment_spocId_endedAt_idx" ON "ClientSpocAssignment"("spocId", "endedAt");

-- CreateIndex
CREATE INDEX "ClientSpocAssignment_assignedToId_endedAt_idx" ON "ClientSpocAssignment"("assignedToId", "endedAt");

-- CreateIndex
CREATE INDEX "ClientNote_clientId_idx" ON "ClientNote"("clientId");

-- CreateIndex
CREATE INDEX "ClientActivity_clientId_createdAt_idx" ON "ClientActivity"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "ClientActivity_spocId_createdAt_idx" ON "ClientActivity"("spocId", "createdAt");

-- CreateIndex
CREATE INDEX "ClientDocument_clientId_idx" ON "ClientDocument"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientDocument_clientId_typeId_fy_key" ON "ClientDocument"("clientId", "typeId", "fy");

-- CreateIndex
CREATE UNIQUE INDEX "ClientFinancial_clientId_fy_key" ON "ClientFinancial"("clientId", "fy");

-- CreateIndex
CREATE INDEX "ClientProgram_sectorId_idx" ON "ClientProgram"("sectorId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientProgram_clientId_fy_name_key" ON "ClientProgram"("clientId", "fy", "name");

-- CreateIndex
CREATE INDEX "OutreachPack_spocId_createdAt_idx" ON "OutreachPack"("spocId", "createdAt");

-- CreateIndex
CREATE INDEX "OutreachPack_clientId_idx" ON "OutreachPack"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "OutreachMessage_packId_sequenceNo_key" ON "OutreachMessage"("packId", "sequenceNo");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalService_code_key" ON "ExternalService"("code");

-- CreateIndex
CREATE INDEX "PipelineStep_isActive_idx" ON "PipelineStep"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "PipelineStep_serviceId_key_key" ON "PipelineStep"("serviceId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "StepRun_idempotencyKey_key" ON "StepRun"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "StepRun_externalJobId_key" ON "StepRun"("externalJobId");

-- CreateIndex
CREATE INDEX "StepRun_status_nextCheckAt_idx" ON "StepRun"("status", "nextCheckAt");

-- CreateIndex
CREATE INDEX "StepRun_stepId_requestedById_status_idx" ON "StepRun"("stepId", "requestedById", "status");

-- CreateIndex
CREATE INDEX "StepRun_clientId_createdAt_idx" ON "StepRun"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "StepRun_spocId_idx" ON "StepRun"("spocId");

-- CreateIndex
CREATE INDEX "StepRun_parentRunId_idx" ON "StepRun"("parentRunId");

-- CreateIndex
CREATE INDEX "StepRunEvent_runId_createdAt_idx" ON "StepRunEvent"("runId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_isRead_idx" ON "Notification"("userId", "isRead");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_module_recordId_idx" ON "AuditLog"("module", "recordId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "BusinessUnit" ADD CONSTRAINT "BusinessUnit_parentBUId_fkey" FOREIGN KEY ("parentBUId") REFERENCES "BusinessUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessUnitServiceLine" ADD CONSTRAINT "BusinessUnitServiceLine_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "BusinessUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessUnitServiceLine" ADD CONSTRAINT "BusinessUnitServiceLine_serviceLineId_fkey" FOREIGN KEY ("serviceLineId") REFERENCES "ServiceLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_designationId_fkey" FOREIGN KEY ("designationId") REFERENCES "Designation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_reportingToId_fkey" FOREIGN KEY ("reportingToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_teamLeadId_fkey" FOREIGN KEY ("teamLeadId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBusinessUnit" ADD CONSTRAINT "UserBusinessUnit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBusinessUnit" ADD CONSTRAINT "UserBusinessUnit_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "BusinessUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserServiceLine" ADD CONSTRAINT "UserServiceLine_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserServiceLine" ADD CONSTRAINT "UserServiceLine_serviceLineId_fkey" FOREIGN KEY ("serviceLineId") REFERENCES "ServiceLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthLogs" ADD CONSTRAINT "AuthLogs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpersonationLog" ADD CONSTRAINT "ImpersonationLog_impersonatorId_fkey" FOREIGN KEY ("impersonatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImpersonationLog" ADD CONSTRAINT "ImpersonationLog_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "Lookup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Lookup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_parentClientId_fkey" FOREIGN KEY ("parentClientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientSpoc" ADD CONSTRAINT "ClientSpoc_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientSpoc" ADD CONSTRAINT "ClientSpoc_handlerId_fkey" FOREIGN KEY ("handlerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientSpoc" ADD CONSTRAINT "ClientSpoc_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "BusinessUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientSpoc" ADD CONSTRAINT "ClientSpoc_serviceLineId_fkey" FOREIGN KEY ("serviceLineId") REFERENCES "ServiceLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientSpoc" ADD CONSTRAINT "ClientSpoc_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "Lookup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientSpoc" ADD CONSTRAINT "ClientSpoc_emailSourceId_fkey" FOREIGN KEY ("emailSourceId") REFERENCES "Lookup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientSpoc" ADD CONSTRAINT "ClientSpoc_salesStatusId_fkey" FOREIGN KEY ("salesStatusId") REFERENCES "Lookup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientSpoc" ADD CONSTRAINT "ClientSpoc_sourceRunId_fkey" FOREIGN KEY ("sourceRunId") REFERENCES "StepRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientSpoc" ADD CONSTRAINT "ClientSpoc_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientSpocAssignment" ADD CONSTRAINT "ClientSpocAssignment_spocId_fkey" FOREIGN KEY ("spocId") REFERENCES "ClientSpoc"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientSpocAssignment" ADD CONSTRAINT "ClientSpocAssignment_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientSpocAssignment" ADD CONSTRAINT "ClientSpocAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientNote" ADD CONSTRAINT "ClientNote_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientNote" ADD CONSTRAINT "ClientNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientActivity" ADD CONSTRAINT "ClientActivity_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientActivity" ADD CONSTRAINT "ClientActivity_spocId_fkey" FOREIGN KEY ("spocId") REFERENCES "ClientSpoc"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientActivity" ADD CONSTRAINT "ClientActivity_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientDocument" ADD CONSTRAINT "ClientDocument_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientDocument" ADD CONSTRAINT "ClientDocument_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "Lookup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientDocument" ADD CONSTRAINT "ClientDocument_sourceRunId_fkey" FOREIGN KEY ("sourceRunId") REFERENCES "StepRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientFinancial" ADD CONSTRAINT "ClientFinancial_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientFinancial" ADD CONSTRAINT "ClientFinancial_sourceRunId_fkey" FOREIGN KEY ("sourceRunId") REFERENCES "StepRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientProgram" ADD CONSTRAINT "ClientProgram_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientProgram" ADD CONSTRAINT "ClientProgram_sectorId_fkey" FOREIGN KEY ("sectorId") REFERENCES "Lookup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientProgram" ADD CONSTRAINT "ClientProgram_sourceRunId_fkey" FOREIGN KEY ("sourceRunId") REFERENCES "StepRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachPack" ADD CONSTRAINT "OutreachPack_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachPack" ADD CONSTRAINT "OutreachPack_spocId_fkey" FOREIGN KEY ("spocId") REFERENCES "ClientSpoc"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachPack" ADD CONSTRAINT "OutreachPack_sourceRunId_fkey" FOREIGN KEY ("sourceRunId") REFERENCES "StepRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutreachMessage" ADD CONSTRAINT "OutreachMessage_packId_fkey" FOREIGN KEY ("packId") REFERENCES "OutreachPack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PipelineStep" ADD CONSTRAINT "PipelineStep_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "ExternalService"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepRun" ADD CONSTRAINT "StepRun_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "PipelineStep"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepRun" ADD CONSTRAINT "StepRun_parentRunId_fkey" FOREIGN KEY ("parentRunId") REFERENCES "StepRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepRun" ADD CONSTRAINT "StepRun_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepRun" ADD CONSTRAINT "StepRun_spocId_fkey" FOREIGN KEY ("spocId") REFERENCES "ClientSpoc"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepRun" ADD CONSTRAINT "StepRun_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepRunEvent" ADD CONSTRAINT "StepRunEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "StepRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
