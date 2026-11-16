// File: aiThread.controller.ts
// Path: src/controller/aiThread.controller.ts
//
// AI threads — saved conversations with the assistant.
//   POST   /ai/threads/ask        { threadId?, prompt, page? } → reply (+ canvas)
//   GET    /ai/threads            my threads (search)
//   POST   /ai/threads            { spec, title? } → a thread from a saved template
//   GET    /ai/threads/:id        conversation + canvas re-read live
//   PATCH  /ai/threads/:id        { title?, pinned? }
//   PUT    /ai/threads/:id/spec   { spec, note } — the user edited the design by hand
//   DELETE /ai/threads/:id        remove from my history
// A thread belongs to one user. Canvas numbers are never stored — only the spec.

import type { Request, Response } from "express";
import { z } from "zod";
import { AI_MAX_INPUT_CHARS } from "@/config/aiGuardrails";
import { SpecInvalid } from "@/services/ai/canvas.service";
import { quotaState } from "@/services/ai/quota.service";
import { assist, pageContextSchema } from "@/services/ai/assist.service";
import { suggestionsFor } from "@/services/ai/thread.service";
import { archiveThread, askThread, editThreadSpec, listThreads, openThread, patchThread, threadFromSpec } from "@/services/ai/thread.service";

const notFound = (res: Response) => res.status(404).json({ success: false, code: "NOT_FOUND", message: "Conversation not found" });
const badSpec = (res: Response, e: unknown) => {
  if (!(e instanceof SpecInvalid)) return false;
  res.status(400).json({ success: false, code: "AI_SPEC_INVALID", message: e.message });
  return true;
};

const askBody = z
  .object({ threadId: z.string().uuid().optional(), prompt: z.string().trim().min(1).max(AI_MAX_INPUT_CHARS), page: z.string().max(200).optional() })
  .strict();

export const ask = async (req: Request, res: Response) => {
  const body = askBody.parse(req.body);
  const reply = await askThread(req.user, req.permissions!, {
    prompt: body.prompt,
    ...(body.threadId && { threadId: body.threadId }),
    ...(body.page && { page: body.page }),
  });
  res.json({ success: true, data: { ...reply, quota: await quotaState(req.user, "CANVAS") } });
};

// POST /ai/assist — the one entry point: knows the page, picks "do it on the page" /
// "show stats" / "explain" / "build a report"
const assistBody = z
  .object({
    threadId: z.string().uuid().optional(),
    prompt: z.string().trim().min(1).max(AI_MAX_INPUT_CHARS),
    page: pageContextSchema,
    // my last question and what it was about — the reply continues that request
    context: z.object({ prompt: z.string().trim().min(1).max(AI_MAX_INPUT_CHARS), question: z.string().max(400) }).strict().optional(),
    // the request that made me ask "do you mean…": remember that it means this one
    learnFrom: z.string().trim().max(AI_MAX_INPUT_CHARS).optional(),
  })
  .strict();

export const assistAsk = async (req: Request, res: Response) => {
  const body = assistBody.parse(req.body);
  const reply = await assist(req.user, req.permissions!, { prompt: body.prompt, threadId: body.threadId, page: body.page, context: body.context, learnFrom: body.learnFrom });
  res.json({ success: true, data: { ...reply, quota: await quotaState(req.user, "CANVAS") } });
};

// GET /ai/suggestions?page=/clients — my top 5 + good questions for this page
export const suggestions = async (req: Request, res: Response) => {
  const page = typeof req.query.page === "string" && /^\/[A-Za-z0-9\-_/]*$/.test(req.query.page) ? req.query.page.slice(0, 200) : "/";
  res.json({ success: true, data: await suggestionsFor(req.user, page) });
};

export const list = async (req: Request, res: Response) => {
  const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 80) : undefined;
  res.json({ success: true, data: await listThreads(req.user, search || undefined) });
};

export const open = async (req: Request, res: Response) => {
  const t = await openThread(req.user, req.permissions!, String(req.params.id));
  if (!t) return void notFound(res);
  res.json({ success: true, data: t });
};

const fromSpecBody = z.object({ spec: z.unknown(), title: z.string().trim().min(1).max(80).optional() }).strict();
export const createFromSpec = async (req: Request, res: Response) => {
  const body = fromSpecBody.parse(req.body);
  try {
    res.status(201).json({ success: true, data: await threadFromSpec(req.user, req.permissions!, body.spec, body.title) });
  } catch (e) {
    if (!badSpec(res, e)) throw e;
  }
};

const patchBody = z.object({ title: z.string().trim().min(1).max(70).optional(), pinned: z.boolean().optional() }).strict();
export const patch = async (req: Request, res: Response) => {
  const body = patchBody.parse(req.body);
  const ok = await patchThread(req.user, String(req.params.id), {
    ...(body.title !== undefined && { title: body.title }),
    ...(body.pinned !== undefined && { pinned: body.pinned }),
  });
  if (!ok) return void notFound(res);
  res.json({ success: true });
};

const editBody = z.object({ spec: z.unknown(), note: z.string().trim().min(1).max(300) }).strict();
export const editSpec = async (req: Request, res: Response) => {
  const body = editBody.parse(req.body);
  try {
    const r = await editThreadSpec(req.user, req.permissions!, String(req.params.id), body.spec, body.note);
    if (!r) return void notFound(res);
    res.json({ success: true, data: r });
  } catch (e) {
    if (!badSpec(res, e)) throw e;
  }
};

export const remove = async (req: Request, res: Response) => {
  if (!(await archiveThread(req.user, String(req.params.id)))) return void notFound(res);
  res.json({ success: true });
};
