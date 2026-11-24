-- the organisation's own office email / phone (B2G bodies, info@ lines); people stay SPOCs
ALTER TABLE "Client" ADD COLUMN "email" TEXT;
ALTER TABLE "Client" ADD COLUMN "phone" TEXT;
