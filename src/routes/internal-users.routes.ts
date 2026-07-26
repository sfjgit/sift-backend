import { resolveRecruiters } from "@/controller/internalUsers.controller";
import { Router } from "express";

const router = Router();

router.get("/", resolveRecruiters);

export default router;
