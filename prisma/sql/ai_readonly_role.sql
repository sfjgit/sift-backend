-- File: ai_readonly_role.sql
-- Path: prisma/sql/ai_readonly_role.sql
--
-- AI assistant layer — L6, the real wall (spec §4). Run ONCE per database by
-- the database owner (Neon console → SQL editor, or psql as the owner role).
-- NOT a Prisma migration on purpose: it carries a password and needs owner
-- rights. Then put the connection string in DATABASE_URL_AI_READONLY.
--
-- Replace <secret> with a long random password (e.g. `openssl rand -hex 24`).
-- Database name: "crm-core-service" (quoted — it has hyphens).

CREATE ROLE ai_readonly WITH LOGIN PASSWORD '21d016fb9a4bfdfc4f3c706d1c67a5dd8da34266ed0fc02c';

GRANT CONNECT ON DATABASE "crm-core-service" TO ai_readonly;
GRANT USAGE ON SCHEMA public TO ai_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO ai_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ai_readonly;

-- every transaction read-only; nothing runs longer than 10 s
ALTER ROLE ai_readonly SET default_transaction_read_only = on;
ALTER ROLE ai_readonly SET statement_timeout = '10s';

-- MANDATORY: sensitive tables — credentials, tokens, sessions, logins, keys
REVOKE SELECT ON "RefreshToken"     FROM ai_readonly;
REVOKE SELECT ON "AuthLogs"         FROM ai_readonly;
REVOKE SELECT ON "ImpersonationLog" FROM ai_readonly;
REVOKE SELECT ON "ExternalService"  FROM ai_readonly;
REVOKE SELECT ON "Tenant"           FROM ai_readonly;
REVOKE SELECT ON "_prisma_migrations" FROM ai_readonly;
-- the AI's own settings / audit are read by the main client, not the AI role
REVOKE SELECT ON "AiAuditLog", "AiModeSetting", "AiQuotaPolicy", "AiUserQuotaOverride",
                 "AiUserPreference", "AiModelPricing", "CommandTemplate", "ReportTemplate"
  FROM ai_readonly;

-- User: no password hash, reset tokens, email, phone or birth date.
-- Column grants mean aiDb must always `select` User columns explicitly.
REVOKE SELECT ON "User" FROM ai_readonly;
GRANT SELECT ("id", "tenantId", "firstName", "lastName", "middleName", "displayName",
              "employeeId", "isActive", "roleId", "departmentId", "designationId",
              "reportingToId", "teamLeadId", "createdAt", "updatedAt")
  ON "User" TO ai_readonly;

-- Check (as ai_readonly) — each of these must fail:
--   SELECT "passwordHash" FROM "User" LIMIT 1;      -- permission denied
--   SELECT * FROM "RefreshToken" LIMIT 1;           -- permission denied
--   UPDATE "Client" SET name = name WHERE false;    -- read-only transaction
