// File: website.controller.ts
// Path: src/controller/website.controller.ts
//
// A client's website that no longer opens: the pop-up's suggestions, replacing
// the website (logged as history), and the history itself. See website.service.

import { Request, Response } from "express";
import { z } from "zod";
import { findClientInScope } from "@/controller/client.controller";
import {
  checkTyped,
  dismissSuggestion,
  mySuggestions,
  oneSuggestion,
  replaceWebsite,
  requestAdmin,
  websiteHistory,
} from "@/services/website.service";

export const replaceWebsiteBody = z.object({
  website: z.string().trim().min(3).max(500),
  runId: z.string().uuid().optional(),
  // an admin saving a typed website the check could not tie to the client
  force: z.boolean().optional(),
});
export const checkWebsiteBody = z.object({ website: z.string().trim().min(3).max(500) });

// ── GET /website-suggestions/mine — what the pop-up shows
export const listMySuggestions = async (req: Request, res: Response) => {
  res.json({ success: true, data: await mySuggestions(req.user.id) });
};

// ── GET /website-suggestions/:id — one check (the dialog opened from a run)
export const getWebsiteSuggestion = async (req: Request, res: Response) => {
  res.json({ success: true, data: await oneSuggestion(req.validatedParams.id) });
};

// ── POST /website-suggestions/:id/dismiss
export const dismissWebsiteSuggestion = async (req: Request, res: Response) => {
  await dismissSuggestion(req.user, req.validatedParams.id);
  res.json({ success: true, message: "Kept the current website" });
};

// ── POST /clients/:id/website { website, runId? } — replace it (the old one stays in the history)
export const replaceClientWebsite = async (req: Request, res: Response) => {
  const { id } = req.validatedParams;
  await findClientInScope(req, id);
  const out = await replaceWebsite(req.user, id, req.validatedBody as z.infer<typeof replaceWebsiteBody>);
  res.json({
    success: true,
    message: out.rerun.length ? "Website replaced — running the failed steps again" : "Website replaced",
    data: out,
  });
};

// ── GET /clients/:id/website-history
export const getWebsiteHistory = async (req: Request, res: Response) => {
  const { id } = req.validatedParams;
  await findClientInScope(req, id);
  res.json({ success: true, data: await websiteHistory(id) });
};

// ── POST /website-suggestions/:id/request-admin
export const requestAdminUpdate = async (req: Request, res: Response) => {
  const out = await requestAdmin(req.user, req.validatedParams.id);
  res.json({ success: true, message: out.alreadyAsked ? "An admin was already asked" : "Sent to the admins", data: out });
};

// ── POST /clients/:id/website/check { website } — an admin checks a typed website
export const checkClientWebsite = async (req: Request, res: Response) => {
  const { id } = req.validatedParams;
  await findClientInScope(req, id);
  res.json({ success: true, data: await checkTyped(id, (req.validatedBody as { website: string }).website) });
};
