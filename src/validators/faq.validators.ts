// File: faq.validators.ts
// Path: src/validators/faq.validators.ts

import { z } from "zod";
import { optionalText } from "@/validators/validator";

export const listFaqsQuery = z.object({
  search: z.string().trim().optional(),
  category: z.string().trim().optional(),
  module: z.string().trim().optional(),
  includeUnpublished: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .default(false),
});

export const createFaqBody = z.object({
  question: z.string().trim().min(1, "Question is required").max(300),
  answer: z.string().trim().min(1, "Answer is required").max(10000),
  category: z.string().trim().min(1, "Category is required").max(100),
  module: optionalText(50),
  order: z.number().int().min(0).optional(),
  isPublished: z.boolean().optional(),
});

export const updateFaqBody = createFaqBody.partial();

export const faqFeedbackBody = z.object({
  helpful: z.boolean(),
});

export type ListFaqsQuery = z.infer<typeof listFaqsQuery>;
export type CreateFaqInput = z.infer<typeof createFaqBody>;
export type UpdateFaqInput = z.infer<typeof updateFaqBody>;
