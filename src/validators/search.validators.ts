// File: search.validators.ts
// Path: src/validators/search.validators.ts

import { z } from "zod";

export const searchQuery = z.object({
  q: z.string().trim().min(2, "Type at least 2 characters").max(100),
  limit: z.coerce.number().int().min(1).max(20).default(5),
});

export type SearchQuery = z.infer<typeof searchQuery>;
