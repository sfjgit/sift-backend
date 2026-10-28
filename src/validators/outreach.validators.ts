// File: outreach.validators.ts
// Path: src/validators/outreach.validators.ts

import { z } from "zod";

export const packParams = z.object({ id: z.string().uuid() });
export const messageParams = z.object({ id: z.string().uuid(), messageId: z.string().uuid() });

// edit a draft mail before it is sent
export const editMessageBody = z
  .object({
    subject: z.string().trim().min(1).max(500).optional(),
    body: z.string().trim().min(1).max(20000).optional(),
  })
  .refine((b) => b.subject !== undefined || b.body !== undefined, "Nothing to update");

// mark one mail sent (from the person's own mailbox) or undo it
export const markSentBody = z.object({
  sent: z.boolean(),
  sentAt: z.coerce
    .date()
    .refine((d) => d.getTime() <= Date.now() + 60_000, "Sent date can't be in the future")
    .optional(),
});

// pack status a person sets; SENT follows from marking mails sent
export const packStatusBody = z.object({
  status: z.enum(["DRAFT", "REVIEWED", "REPLIED", "NO_REPLY", "BOUNCED"]),
  note: z.string().trim().max(2000).optional(),
  repliedAt: z.coerce.date().optional(),
});

export type PackStatusInput = z.infer<typeof packStatusBody>;
