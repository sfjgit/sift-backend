// File: geo.validators.ts
// Path: src/validators/geo.validators.ts

import { z } from "zod";
import { csv } from "@/validators/validator";

const names = csv(z.string().trim().min(1).max(100));

export const geoQuery = z.object({
  q: z.string().trim().max(100).optional(),
  // names or ISO codes; none = India
  country: names,
  state: names,
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export type GeoQuery = z.infer<typeof geoQuery>;
