// File: naukriAccountability.routes.ts
// Path: core-service/src/modules/naukri/naukriAccountability.routes.ts

import { Router } from "express";
import * as c from "@/controller/naukriAccountability.controller";
// import your existing auth middleware that sets req.user
// import { requireAuth } from '../../middleware/auth';

const router = Router();

router.get("/me", c.getMe); // self — recruiter's own page
router.get("/team", c.getTeam); // DL / DM / admin — reportees
router.post("/reason", c.saveReason); // recruiter explains the gap
router.post("/promise", c.makePromise); // recruiter promises
router.post("/evaluate", c.evaluatePromises); // cron/admin: judge yesterday's promises

router.get("/memes", c.listMemes);
router.post("/memes", c.addMeme);

export default router;
