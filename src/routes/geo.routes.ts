// File: geo.routes.ts
// Path: src/routes/geo.routes.ts
//
// Country → state → city pick-lists (bundled data, no DB). Any signed-in user.

import { Router, Request, Response } from "express";
import { authenticateUser } from "@/middleware/auth";
import { validate } from "@/validators/validator";
import { geoQuery, type GeoQuery } from "@/validators/geo.validators";
import { listCities, listCountries, listStates } from "@/services/geo.service";

const router = Router();

router.use(authenticateUser);

router.get("/countries", validate.query(geoQuery), (req: Request, res: Response) => {
  const q = req.validatedQuery as GeoQuery;
  res.json({ success: true, data: listCountries(q.q) }); // 250 rows — always all
});

router.get("/states", validate.query(geoQuery), (req: Request, res: Response) => {
  const q = req.validatedQuery as GeoQuery;
  res.json({ success: true, data: listStates(q.country, q.q) });
});

router.get("/cities", validate.query(geoQuery), (req: Request, res: Response) => {
  const q = req.validatedQuery as GeoQuery;
  res.json({
    success: true,
    data: listCities({ countries: q.country, states: q.state, q: q.q, limit: q.limit }),
  });
});

export default router;
