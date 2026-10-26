// File: serviceAuth.ts
// Path: src/middleware/serviceAuth.ts
//
// /api/svc/* guard for external services (CSR pipeline engine). The service
// sends X-Service-Key; the CRM stores only sha256(key) on ExternalService.

import crypto from "crypto";
import { Request, Response, NextFunction } from "express";
import prisma from "@/utils/prisma/client";

export const hashServiceKey = (key: string) =>
  crypto.createHash("sha256").update(key, "utf8").digest("hex");

const sameHash = (a: string, b: string) =>
  a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

export const authenticateService = async (req: Request, res: Response, next: NextFunction) => {
  const key = req.header("x-service-key")?.trim();
  if (!key) {
    res.status(401).json({ success: false, code: "NO_SERVICE_KEY", message: "X-Service-Key missing" });
    return;
  }

  const hash = hashServiceKey(key);
  const services = await prisma.externalService.findMany({
    where: { isActive: true, inboundKeyHash: { not: null } },
    select: { id: true, code: true, scopes: true, inboundKeyHash: true },
  });
  const service = services.find((s) => sameHash(s.inboundKeyHash!, hash));
  if (!service) {
    res.status(401).json({ success: false, code: "INVALID_SERVICE_KEY", message: "Unknown service key" });
    return;
  }

  req.service = { id: service.id, code: service.code, scopes: service.scopes };
  void prisma.externalService
    .update({ where: { id: service.id }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);
  next();
};

export const requireServiceScope =
  (scope: string) => (req: Request, res: Response, next: NextFunction) => {
    if (!req.service?.scopes.includes(scope)) {
      res.status(403).json({ success: false, code: "FORBIDDEN", message: `Missing scope: ${scope}` });
      return;
    }
    next();
  };
