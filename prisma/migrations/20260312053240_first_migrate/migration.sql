-- CreateEnum
CREATE TYPE "public"."PermissionScope" AS ENUM ('OWN', 'TEAM', 'BU', 'ALL');

-- CreateEnum
CREATE TYPE "public"."TeamRole" AS ENUM ('LEAD', 'CO_LEAD', 'MEMBER');

-- CreateEnum
CREATE TYPE "public"."TeamDataPolicy" AS ENUM ('SHARED', 'LEAD_ONLY');

-- CreateEnum
CREATE TYPE "public"."ClientStatus" AS ENUM ('PENDING', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "public"."DocumentEventType" AS ENUM ('FILE_UPLOAD', 'STATUS_CHANGE', 'ISSUE_RAISED', 'NOTE', 'POSITION_FILLED', 'REQUIREMENT_CLOSED');

-- CreateEnum
CREATE TYPE "public"."AssignmentType" AS ENUM ('INDIVIDUAL', 'TEAM');

-- CreateEnum
CREATE TYPE "public"."RequirementType" AS ENUM ('CONTRACT', 'PERMANENT', 'CONTRACT_TO_HIRE', 'FREELANCE');

-- CreateEnum
CREATE TYPE "public"."RemoteType" AS ENUM ('ONSITE', 'REMOTE', 'HYBRID');

-- CreateEnum
CREATE TYPE "public"."Priority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "public"."RequirementStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'ON_HOLD', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "public"."FlowNodeType" AS ENUM ('BUSINESS_UNIT', 'TEAM', 'USER', 'CLIENT', 'REQUIREMENT');

-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "passwordPlain" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "middleName" TEXT,
    "nickName" TEXT,
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
    "reportingToId" TEXT,
    "businessUnitId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RefreshToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Role" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RolePermission" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "canView" BOOLEAN NOT NULL DEFAULT false,
    "canAdd" BOOLEAN NOT NULL DEFAULT false,
    "canEdit" BOOLEAN NOT NULL DEFAULT false,
    "canDelete" BOOLEAN NOT NULL DEFAULT false,
    "scope" "public"."PermissionScope" NOT NULL DEFAULT 'OWN',

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Team" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "category" TEXT,
    "parentTeamId" TEXT,
    "businessUnitId" TEXT,
    "dataPolicy" "public"."TeamDataPolicy" NOT NULL DEFAULT 'SHARED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TeamMember" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "teamRole" "public"."TeamRole" NOT NULL DEFAULT 'MEMBER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."BusinessUnit" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "parentBUId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Client" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vmsName" TEXT,
    "category" TEXT,
    "industry" TEXT,
    "website" TEXT,
    "country" TEXT NOT NULL DEFAULT 'India',
    "state" TEXT,
    "city" TEXT,
    "address" TEXT,
    "status" "public"."ClientStatus" NOT NULL DEFAULT 'PENDING',
    "businessUnitId" TEXT,
    "createdBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "parentClientId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ClientHandler" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "assignedBy" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientHandler_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ClientTeamAssignment" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "assignedBy" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientTeamAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ClientContact" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT,
    "designation" TEXT,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "linkedinUrl" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ContactHandler" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignedBy" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactHandler_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ClientNote" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Requirement" (
    "id" TEXT NOT NULL,
    "reqCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "clientId" TEXT NOT NULL,
    "clientContactId" TEXT,
    "businessUnitId" TEXT,
    "jobType" "public"."RequirementType" NOT NULL,
    "remoteType" "public"."RemoteType" NOT NULL,
    "priority" "public"."Priority" NOT NULL DEFAULT 'MEDIUM',
    "totalOpenings" INTEGER NOT NULL DEFAULT 1,
    "filledOpenings" INTEGER NOT NULL DEFAULT 0,
    "location" TEXT,
    "country" TEXT,
    "salaryMin" DOUBLE PRECISION,
    "salaryMax" DOUBLE PRECISION,
    "salaryType" TEXT,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "respondBy" TIMESTAMP(3),
    "turnaroundDays" INTEGER,
    "closedAt" TIMESTAMP(3),
    "status" "public"."RequirementStatus" NOT NULL DEFAULT 'DRAFT',
    "createdBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "deliveryLeadId" TEXT,
    "teamLeadId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Requirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RequirementDocument" (
    "id" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "type" "public"."DocumentEventType" NOT NULL,
    "fileName" TEXT,
    "fileUrl" TEXT,
    "fileType" TEXT,
    "content" TEXT,
    "isIssue" BOOLEAN NOT NULL DEFAULT false,
    "issueResolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "raisedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequirementDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RequirementAssignment" (
    "id" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "assignmentType" "public"."AssignmentType" NOT NULL,
    "recruiterId" TEXT,
    "teamId" TEXT,
    "allocatedOpenings" INTEGER,
    "filledOpenings" INTEGER NOT NULL DEFAULT 0,
    "isAutoRouted" BOOLEAN NOT NULL DEFAULT false,
    "assignedBy" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequirementAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RequirementNote" (
    "id" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RequirementNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RequirementStatusHistory" (
    "id" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "fromStatus" "public"."RequirementStatus" NOT NULL,
    "toStatus" "public"."RequirementStatus" NOT NULL,
    "changedBy" TEXT NOT NULL,
    "reason" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequirementStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."OrgFlow" (
    "id" TEXT NOT NULL,
    "fromType" "public"."FlowNodeType" NOT NULL,
    "fromId" TEXT NOT NULL,
    "fromLabel" TEXT NOT NULL,
    "toType" "public"."FlowNodeType" NOT NULL,
    "toId" TEXT NOT NULL,
    "toLabel" TEXT NOT NULL,
    "relation" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrgFlow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AuditLog" (
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
CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_employeeId_key" ON "public"."User"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_token_key" ON "public"."RefreshToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "Role_name_key" ON "public"."Role"("name");

-- CreateIndex
CREATE UNIQUE INDEX "RolePermission_roleId_module_key" ON "public"."RolePermission"("roleId", "module");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMember_userId_teamId_key" ON "public"."TeamMember"("userId", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessUnit_name_key" ON "public"."BusinessUnit"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ClientHandler_clientId_userId_key" ON "public"."ClientHandler"("clientId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientTeamAssignment_clientId_teamId_key" ON "public"."ClientTeamAssignment"("clientId", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "ContactHandler_contactId_userId_key" ON "public"."ContactHandler"("contactId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Requirement_reqCode_key" ON "public"."Requirement"("reqCode");

-- CreateIndex
CREATE UNIQUE INDEX "RequirementAssignment_requirementId_recruiterId_key" ON "public"."RequirementAssignment"("requirementId", "recruiterId");

-- CreateIndex
CREATE UNIQUE INDEX "OrgFlow_fromType_fromId_toType_toId_relation_key" ON "public"."OrgFlow"("fromType", "fromId", "toType", "toId", "relation");

-- AddForeignKey
ALTER TABLE "public"."User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "public"."Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."User" ADD CONSTRAINT "User_reportingToId_fkey" FOREIGN KEY ("reportingToId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."User" ADD CONSTRAINT "User_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "public"."BusinessUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "public"."Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Team" ADD CONSTRAINT "Team_parentTeamId_fkey" FOREIGN KEY ("parentTeamId") REFERENCES "public"."Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Team" ADD CONSTRAINT "Team_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "public"."BusinessUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TeamMember" ADD CONSTRAINT "TeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TeamMember" ADD CONSTRAINT "TeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "public"."Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."BusinessUnit" ADD CONSTRAINT "BusinessUnit_parentBUId_fkey" FOREIGN KEY ("parentBUId") REFERENCES "public"."BusinessUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Client" ADD CONSTRAINT "Client_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "public"."BusinessUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Client" ADD CONSTRAINT "Client_parentClientId_fkey" FOREIGN KEY ("parentClientId") REFERENCES "public"."Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ClientHandler" ADD CONSTRAINT "ClientHandler_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ClientTeamAssignment" ADD CONSTRAINT "ClientTeamAssignment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ClientTeamAssignment" ADD CONSTRAINT "ClientTeamAssignment_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "public"."Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ClientContact" ADD CONSTRAINT "ClientContact_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ContactHandler" ADD CONSTRAINT "ContactHandler_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "public"."ClientContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ClientNote" ADD CONSTRAINT "ClientNote_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Requirement" ADD CONSTRAINT "Requirement_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "public"."Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Requirement" ADD CONSTRAINT "Requirement_clientContactId_fkey" FOREIGN KEY ("clientContactId") REFERENCES "public"."ClientContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Requirement" ADD CONSTRAINT "Requirement_businessUnitId_fkey" FOREIGN KEY ("businessUnitId") REFERENCES "public"."BusinessUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequirementDocument" ADD CONSTRAINT "RequirementDocument_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "public"."Requirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequirementAssignment" ADD CONSTRAINT "RequirementAssignment_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "public"."Requirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequirementAssignment" ADD CONSTRAINT "RequirementAssignment_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "public"."Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequirementNote" ADD CONSTRAINT "RequirementNote_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "public"."Requirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RequirementStatusHistory" ADD CONSTRAINT "RequirementStatusHistory_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "public"."Requirement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
