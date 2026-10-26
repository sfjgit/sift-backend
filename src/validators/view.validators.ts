// File: view.validators.ts
// Path: src/validators/view.validators.ts

import { z } from "zod";

export const listViewsQuery = z.object({
  module: z.string().trim().min(1).max(50).optional(),
});

export const createViewBody = z.object({
  module: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1, "Name is required").max(100),
  config: z.record(z.string(), z.unknown()), // opaque to the backend
  isDefault: z.boolean().optional(),
  isShared: z.boolean().optional(),
});

export const updateViewBody = createViewBody.partial();

export type ListViewsQuery = z.infer<typeof listViewsQuery>;
export type CreateViewInput = z.infer<typeof createViewBody>;
export type UpdateViewInput = z.infer<typeof updateViewBody>;
