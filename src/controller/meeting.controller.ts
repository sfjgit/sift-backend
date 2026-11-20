// File: meeting.controller.ts
// Path: src/controller/meeting.controller.ts
//
// The full meeting (CASPA add_meeting_new.php) behind a MEETING task:
// mode / link / attendees, minutes 1–4, meeting + proposal status, proposal
// date / amount, tentative date, category, MOU (shared, programme: dates,
// semesters, credits, students, courses), credit signed date, files (MOM,
// RFP, proposal, MOU, credit letter, sales pitch, visit photo) and the client
// visit check-in (address, pincode, GPS).
// Marking it Completed closes the task and sends it to the lead for approval.
//
//   GET    /clients/:id/tasks/:taskId/meeting
//   PUT    /clients/:id/tasks/:taskId/meeting
//   POST   /clients/:id/tasks/:taskId/meeting/files            (multipart: file, kind)
//   GET    /clients/:id/tasks/:taskId/meeting/files/:fileId/url
//   DELETE /clients/:id/tasks/:taskId/meeting/files/:fileId
//   POST   /clients/:id/tasks/:taskId/meeting/approval          { decision }

import { Request, Response } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import prisma from "@/utils/prisma/client";
import { ApiError, notFound } from "@/utils/httpError";
import { deleteFromS3, getSignedUrl, uploadToS3 } from "@/lib/s3";
import { logClientActivity } from "@/services/clientActivity.service";
import { findClientInScope } from "@/controller/client.controller";

// the CASPA choices, served to the web and the phone
export const MEETING_OPTIONS = {
  modes: ["virtual", "offline"],
  statuses: ["Meeting Scheduled", "Completed", "Cancelled"],
  proposalStatuses: ["Proposal Submitted", "Proposal Discussion", "Proposal Lost", "Proposal Deal Closed", "Proposal Deal Completed"],
  categories: [
    "Enterprise -CSR", "Enterprise -KaaS", "Enterprise -OEM", "Enterprise -TaaS",
    "B2I -KaaS_Students", "B2I -OEM", "B2I -Faculty Deployment", "B2I -Faculty Training", "B2I -CSR",
    "B2G_Skilling -", "B2G_Skilling -CPSU Scheme Training", "B2G_Skilling -SPSU Scheme Training", "B2G_Skilling -OEM",
    "B2G_Skilling -TaaS", "B2G_Skilling -CSR", "B2G_PSU -KaaS", "B2G_PSU -OEM", "B2G_PSU -TaaS", "B2G_PSU -CSR",
    "Global -KaaS", "Global -OEM", "Global -CSR", "Global -TaaS",
  ],
  semesters: ["1", "2", "3", "4", "5", "6", "7", "8"],
  credits: ["1", "2", "3", "4", "5", "5+"],
  courses: [
    "AWS Cloud", "Microsoft Azure", "Microsoft 365", "CompTIA", "Oracle", "SAP", "Salesforce", "PMP", "PRINCE2",
    "Python", "Java", "Data Analytics", "Data Science", "Artificial Intelligence", "Machine Learning", "Generative AI",
    "Cyber Security", "DevOps", "Full Stack Development", "Power BI", "Tableau", "ServiceNow",
  ],
  fileKinds: ["MOM", "RFP", "PROPOSAL", "MOU", "CREDIT_LETTER", "SALES_PITCH", "VISIT_PHOTO"],
} as const;

const PERSON = { id: true, firstName: true, lastName: true } as const;
const MEETING_SELECT = {
  id: true,
  mode: true,
  link: true,
  revenueGenerated: true,
  attendeeCount: true,
  sfjAttendeeIds: true,
  clientAttendeeNames: true,
  clientAttendeeEmails: true,
  minutes: true,
  meetingStatus: true,
  approvalStatus: true,
  approvedAt: true,
  approvedBy: { select: PERSON },
  proposalStatus: true,
  proposalDate: true,
  proposalAmountRs: true,
  tentativeDate: true,
  salesUser: { select: PERSON },
  category: true,
  notes: true,
  mouShared: true,
  creditSignedDate: true,
  mouStartDate: true,
  mouEndDate: true,
  semesters: true,
  credits: true,
  studentCount: true,
  courses: true,
  visitAddress: true,
  visitPincode: true,
  visitLat: true,
  visitLng: true,
  visitAt: true,
  files: { select: { id: true, kind: true, fileName: true, createdAt: true, uploadedBy: { select: PERSON } }, orderBy: { createdAt: "desc" as const } },
  updatedAt: true,
} as const satisfies Prisma.MeetingDetailSelect;

const opt = (n: number) => z.string().trim().max(n).nullable().optional();
const day = z.coerce.date().nullable().optional();
const oneOf = <T extends readonly [string, ...string[]]>(xs: T) => z.enum(xs).nullable().optional();

export const meetingBody = z
  .object({
    // the task itself
    title: z.string().trim().min(1).max(300).optional(),
    spocId: z.string().uuid().nullable().optional(),
    dueAt: z.coerce.date().nullable().optional(),
    // the meeting
    mode: oneOf(MEETING_OPTIONS.modes as unknown as [string, ...string[]]),
    link: opt(1000),
    revenueGenerated: opt(200),
    attendeeCount: z.coerce.number().int().min(0).max(10_000).nullable().optional(),
    sfjAttendeeIds: z.array(z.string().uuid()).max(50).optional(),
    clientAttendeeNames: opt(2000),
    clientAttendeeEmails: opt(2000),
    minutes: z.array(z.string().max(20_000)).max(4).optional(),
    meetingStatus: oneOf(MEETING_OPTIONS.statuses as unknown as [string, ...string[]]),
    proposalStatus: oneOf(MEETING_OPTIONS.proposalStatuses as unknown as [string, ...string[]]),
    proposalDate: day,
    proposalAmountRs: z.coerce.number().min(0).max(1e14).nullable().optional(),
    tentativeDate: day,
    salesUserId: z.string().uuid().nullable().optional(),
    category: oneOf(MEETING_OPTIONS.categories as unknown as [string, ...string[]]),
    notes: opt(5000),
    mouShared: z.boolean().nullable().optional(),
    creditSignedDate: day,
    mouStartDate: day,
    mouEndDate: day,
    semesters: z.array(z.enum(MEETING_OPTIONS.semesters as unknown as [string, ...string[]])).optional(),
    credits: z.array(z.enum(MEETING_OPTIONS.credits as unknown as [string, ...string[]])).optional(),
    studentCount: z.coerce.number().int().min(0).max(1_000_000).nullable().optional(),
    courses: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
    // check-in
    visitAddress: opt(500),
    visitPincode: opt(10),
    visitLat: z.coerce.number().min(-90).max(90).nullable().optional(),
    visitLng: z.coerce.number().min(-180).max(180).nullable().optional(),
  })
  .strict();

export const meetingParams = z.object({ id: z.string().uuid(), taskId: z.string().uuid() });
export const meetingFileParams = meetingParams.extend({ fileId: z.string().uuid() });
export const meetingFileBody = z.object({ kind: z.enum(MEETING_OPTIONS.fileKinds as unknown as [string, ...string[]]) });
export const meetingApprovalBody = z.object({ decision: z.enum(["APPROVED", "REJECTED"]), note: z.string().trim().max(500).optional() });

/** our attendees by name (the row keeps ids) */
async function withAttendees<T extends { sfjAttendeeIds: string[] } | null>(m: T) {
  if (!m) return m;
  const sfjAttendees = m.sfjAttendeeIds.length
    ? await prisma.user.findMany({ where: { id: { in: m.sfjAttendeeIds } }, select: PERSON })
    : [];
  return { ...m, sfjAttendees };
}

async function meetingTask(req: Request) {
  const { id, taskId } = req.validatedParams as { id: string; taskId: string };
  await findClientInScope(req, id);
  const task = await prisma.workTask.findFirst({
    where: { id: taskId, clientId: id, kind: "MEETING" },
    select: { id: true, title: true, dueAt: true, status: true, spocId: true, assigneeId: true, assignee: { select: { reportingToId: true } }, client: { select: { tenantId: true } } },
  });
  if (!task) throw notFound("Meeting");
  return { clientId: id, task };
}

/** the lead who approves: the owner's manager, a super admin, or anyone with clients.approve */
const canApprove = (req: Request, task: { assigneeId: string; assignee: { reportingToId: string | null } }) =>
  req.user.isSuperAdmin || task.assignee.reportingToId === req.user.id || !!req.permissions?.["clients.approve"];

// ── GET
export const getMeeting = async (req: Request, res: Response) => {
  const { task } = await meetingTask(req);
  const meeting = await prisma.meetingDetail.findUnique({ where: { taskId: task.id }, select: MEETING_SELECT });
  res.json({ success: true, data: { meeting: await withAttendees(meeting), options: MEETING_OPTIONS, canApprove: canApprove(req, task) } });
};

// ── PUT (create or update)
export const saveMeeting = async (req: Request, res: Response) => {
  const { clientId, task } = await meetingTask(req);
  const b = req.validatedBody as z.infer<typeof meetingBody>;
  const { title, spocId, dueAt, visitLat, visitLng, proposalAmountRs, ...m } = b;

  const before = await prisma.meetingDetail.findUnique({ where: { taskId: task.id }, select: { approvalStatus: true, meetingStatus: true } });
  const completing = m.meetingStatus === "Completed" && before?.meetingStatus !== "Completed";
  const cancelling = m.meetingStatus === "Cancelled" && before?.meetingStatus !== "Cancelled";
  // only the fields that were sent (absent = leave as is)
  const defined = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
  const data = defined({
    ...m,
    ...(proposalAmountRs !== undefined && { proposalAmountRs: proposalAmountRs === null ? null : new Prisma.Decimal(proposalAmountRs) }),
    ...(visitLat !== undefined && { visitLat: visitLat === null ? null : new Prisma.Decimal(visitLat) }),
    ...(visitLng !== undefined && { visitLng: visitLng === null ? null : new Prisma.Decimal(visitLng) }),
    ...(visitLat != null && visitLng != null && { visitAt: new Date() }),
    // CASPA: Completed goes to the lead, unless already approved
    ...(completing && before?.approvalStatus !== "APPROVED" && { approvalStatus: "PENDING" }),
  }) as Prisma.MeetingDetailUncheckedUpdateInput;

  const meeting = await prisma.$transaction(async (tx) => {
    await tx.workTask.update({
      where: { id: task.id },
      data: {
        ...(title !== undefined && { title }),
        ...(spocId !== undefined && { spocId }),
        ...(dueAt !== undefined && { dueAt }),
        ...((completing || cancelling) && { status: "DONE", closedAt: new Date(), closedById: req.user.id }),
        ...(completing && m.minutes?.[0] && { closeNote: m.minutes[0].slice(0, 2000) }),
        ...(cancelling && { closeNote: "Cancelled" }),
      },
    });
    const row = await tx.meetingDetail.upsert({
      where: { taskId: task.id },
      create: { ...(data as Prisma.MeetingDetailUncheckedCreateInput), taskId: task.id },
      update: data,
      select: MEETING_SELECT,
    });
    await logClientActivity(tx, {
      clientId,
      spocId: spocId ?? task.spocId,
      actorId: req.user.id,
      type: completing ? "TASK_CLOSED" : "TASK_UPDATED",
      summary: completing
        ? `Meeting completed: ${title ?? task.title} — sent for approval`
        : cancelling
          ? `Meeting cancelled: ${title ?? task.title}`
          : `Meeting updated: ${title ?? task.title}${m.visitAddress ? " — checked in" : ""}`,
    });
    return row;
  });
  res.json({ success: true, data: await withAttendees(meeting) });
};

// ── files
export const uploadMeetingFile = async (req: Request, res: Response) => {
  const { clientId, task } = await meetingTask(req);
  const { kind } = req.validatedBody as z.infer<typeof meetingFileBody>;
  const file = req.file;
  if (!file) throw ApiError(400, "Choose a file to upload", "NO_FILE");
  if (!process.env.AWS_BUCKET) throw ApiError(503, "File storage is not configured", "STORAGE_UNAVAILABLE");
  const meeting = await prisma.meetingDetail.upsert({ where: { taskId: task.id }, create: { taskId: task.id }, update: {}, select: { id: true } });
  const fileKey = await uploadToS3({
    folder: `tenants/${task.client.tenantId}/clients/${clientId}/meetings/${task.id}`,
    fileName: file.originalname,
    buffer: file.buffer,
    mimeType: file.mimetype,
  });
  const row = await prisma.meetingFile.create({
    data: { meetingId: meeting.id, kind, fileKey, fileName: file.originalname, uploadedById: req.user.id },
    select: { id: true, kind: true, fileName: true, createdAt: true },
  });
  res.status(201).json({ success: true, data: row });
};

const findFile = async (req: Request) => {
  const { task } = await meetingTask(req);
  const { fileId } = req.validatedParams as { fileId: string };
  const f = await prisma.meetingFile.findFirst({ where: { id: fileId, meeting: { taskId: task.id } }, select: { id: true, fileKey: true, fileName: true } });
  if (!f) throw notFound("File");
  return f;
};

export const meetingFileUrl = async (req: Request, res: Response) => {
  const f = await findFile(req);
  if (!process.env.AWS_BUCKET) throw ApiError(503, "File storage is not configured", "STORAGE_UNAVAILABLE");
  res.json({ success: true, data: { url: await getSignedUrl(f.fileKey, 60 * 15), fileName: f.fileName } });
};

export const deleteMeetingFile = async (req: Request, res: Response) => {
  const f = await findFile(req);
  await prisma.meetingFile.delete({ where: { id: f.id } });
  void deleteFromS3(f.fileKey).catch(() => undefined);
  res.json({ success: true });
};

// ── lead approval of a completed meeting
export const decideMeeting = async (req: Request, res: Response) => {
  const { clientId, task } = await meetingTask(req);
  if (!canApprove(req, task)) throw ApiError(403, "Only the lead can approve this meeting", "FORBIDDEN");
  const { decision, note } = req.validatedBody as z.infer<typeof meetingApprovalBody>;
  const meeting = await prisma.$transaction(async (tx) => {
    const row = await tx.meetingDetail.update({
      where: { taskId: task.id },
      data: { approvalStatus: decision, approvedById: req.user.id, approvedAt: new Date() },
      select: MEETING_SELECT,
    });
    await logClientActivity(tx, {
      clientId,
      spocId: task.spocId,
      actorId: req.user.id,
      type: "TASK_UPDATED",
      summary: `Meeting ${decision === "APPROVED" ? "approved" : "sent back"}: ${task.title}${note ? ` — ${note}` : ""}`,
    });
    return row;
  });
  res.json({ success: true, data: meeting });
};
