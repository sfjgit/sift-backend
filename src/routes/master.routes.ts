// File: master.routes.ts
// Path: src/routes/master.routes.ts
//
// /service-lines, /departments, /designations — read: any logged-in user,
// write: org.manage

import { Router } from "express";
import { z } from "zod";
import { authenticateUser } from "@/middleware/auth";
import { authorize } from "@/middleware/authorize";
import { validate, idParams, optionalText } from "@/validators/validator";
import { masterController } from "@/controller/master.controller";

const createMasterBody = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  code: optionalText(50),
});
const updateMasterBody = createMasterBody.partial();

export const masterRouter = (
  model: Parameters<typeof masterController>[0],
  label: string,
) => {
  const c = masterController(model, label);
  const router = Router();
  const manage = authorize("org.manage");

  router.use(authenticateUser);

  router.get("/", c.list);
  router.get("/:id", validate.params(idParams), c.getById);
  router.post("/", manage, validate.body(createMasterBody), c.create);
  router.put(
    "/:id",
    manage,
    validate.request({ params: idParams, body: updateMasterBody }),
    c.update,
  );
  router.patch("/:id/toggle", manage, validate.params(idParams), c.toggle);

  return router;
};
