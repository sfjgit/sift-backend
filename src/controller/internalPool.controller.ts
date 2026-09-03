// File: internalPool.controller.ts
// Path: src/controllers/internalPool.controller.ts

import { Request, Response } from "express";
import {
  listSavedSearches,
  createSavedSearch,
  updateSavedSearch,
  deleteSavedSearch,
  touchSavedSearch,
  logSearchActivity,
  logSourcingActivity,
  sourceCandidateToRequirement,
  getInternalPoolActivitySummary,
} from "../services/internalPool.service";

// =============================================================================
// SAVED SEARCHES
// =============================================================================

// GET /api/internal-pool/saved-searches?requirementId=xxx
export const listSavedSearchesController = async (
  req: Request,
  res: Response
) => {
  try {
    const recruiterId = req.user.id;
    const requirementId = req.query.requirementId as string | undefined;

    const searches = await listSavedSearches(recruiterId, requirementId);
    return res.status(200).json({ success: true, data: searches });
  } catch (err: any) {
    console.error("[listSavedSearchesController]", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch saved searches" });
  }
};

// POST /api/internal-pool/saved-searches
// Body: { name, filters, requirementId?, assignmentId? }
export const createSavedSearchController = async (
  req: Request,
  res: Response
) => {
  try {
    const recruiterId = req.user.id;
    const { name, filters, requirementId, assignmentId } = req.body;

    if (!name?.trim()) {
      return res
        .status(400)
        .json({ success: false, message: "name is required" });
    }
    if (!filters || typeof filters !== "object") {
      return res
        .status(400)
        .json({ success: false, message: "filters object is required" });
    }

    const saved = await createSavedSearch({
      recruiterId,
      requirementId: requirementId ?? undefined,
      assignmentId: assignmentId ?? undefined,
      name: name.trim(),
      filters,
    });

    return res.status(201).json({ success: true, data: saved });
  } catch (err: any) {
    console.error("[createSavedSearchController]", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to save search" });
  }
};

// PATCH /api/internal-pool/saved-searches/:id
// Body: { name?, filters? }
export const updateSavedSearchController = async (
  req: Request,
  res: Response
) => {
  try {
    const recruiterId = req.user.id;
    const { id } = req.params;
    const { name, filters } = req.body;

    if (!name && !filters) {
      return res
        .status(400)
        .json({ success: false, message: "Provide name or filters to update" });
    }

    const updated = await updateSavedSearch(id, recruiterId, { name, filters });

    if (!updated) {
      return res
        .status(404)
        .json({ success: false, message: "Saved search not found" });
    }

    return res.status(200).json({ success: true, data: updated });
  } catch (err: any) {
    console.error("[updateSavedSearchController]", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to update saved search" });
  }
};

// DELETE /api/internal-pool/saved-searches/:id
export const deleteSavedSearchController = async (
  req: Request,
  res: Response
) => {
  try {
    const recruiterId = req.user.id;
    const { id } = req.params;

    const deleted = await deleteSavedSearch(id, recruiterId);

    if (!deleted) {
      return res
        .status(404)
        .json({ success: false, message: "Saved search not found" });
    }

    return res
      .status(200)
      .json({ success: true, message: "Saved search deleted" });
  } catch (err: any) {
    console.error("[deleteSavedSearchController]", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to delete saved search" });
  }
};

// POST /api/internal-pool/saved-searches/:id/run
// Bumps lastRunAt + runCount. Frontend calls this when re-running a saved search.
export const runSavedSearchController = async (req: Request, res: Response) => {
  try {
    const recruiterId = req.user.id;
    const { id } = req.params;

    const updated = await touchSavedSearch(id, recruiterId);

    if (!updated) {
      return res
        .status(404)
        .json({ success: false, message: "Saved search not found" });
    }

    return res.status(200).json({ success: true, data: updated });
  } catch (err: any) {
    console.error("[runSavedSearchController]", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to update saved search run" });
  }
};

// =============================================================================
// ACTIVITY LOGGING
// =============================================================================

// POST /api/internal-pool/log/search
// Fire and forget from frontend after every search.
// Body: { requirementId?, assignmentId?, filters, resultCount? }
export const logSearchController = async (req: Request, res: Response) => {
  try {
    const recruiterId = req.user.id;
    const { requirementId, assignmentId, filters, resultCount } = req.body;

    if (!filters || typeof filters !== "object") {
      return res
        .status(400)
        .json({ success: false, message: "filters object is required" });
    }

    // Non-blocking — respond immediately, log async
    res.status(202).json({ success: true });

    logSearchActivity({
      recruiterId,
      requirementId: requirementId ?? undefined,
      assignmentId: assignmentId ?? undefined,
      filters,
      resultCount: resultCount ?? undefined,
    }).catch((err) =>
      console.error("[logSearchActivity] failed (non-critical):", err)
    );
  } catch (err: any) {
    console.error("[logSearchController]", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to log search" });
  }
};

// =============================================================================
// SOURCE CANDIDATE — "Add to Requirement"
// POST /api/internal-pool/source
// Body: { candidateServiceId, requirementId, assignmentId?, fullName, email,
//         phone?, currentTitle?, currentCompany?, totalExpYears?,
//         topSkills?, resumeUrl?, rawSnapshot }
// =============================================================================

export const sourceCandidateController = async (
  req: Request,
  res: Response
) => {
  try {
    const recruiterId = req.user.id;
    const {
      candidateServiceId,
      requirementId,
      assignmentId,
      fullName,
      email,
      phone,
      currentTitle,
      currentCompany,
      totalExpYears,
      topSkills,
      resumeUrl,
      rawSnapshot,
    } = req.body;

    // ── Required field validation ─────────────────────────────────────────
    if (!candidateServiceId || !requirementId || !fullName || !email) {
      return res.status(400).json({
        success: false,
        message:
          "candidateServiceId, requirementId, fullName, email are required",
      });
    }

    const result = await sourceCandidateToRequirement({
      candidateServiceId,
      requirementId,
      recruiterId,
      assignmentId: assignmentId ?? null,
      fullName,
      email,
      phone: phone ?? null,
      currentTitle: currentTitle ?? null,
      currentCompany: currentCompany ?? null,
      totalExpYears: totalExpYears ?? null,
      topSkills: topSkills ?? [],
      resumeUrl: resumeUrl ?? null,
      rawSnapshot: rawSnapshot ?? {},
    });

    if (result.alreadyExists) {
      return res.status(200).json({
        success: true,
        alreadyExists: true,
        message: "Candidate already sourced for this requirement",
        data: { snapshot: result.snapshot, pipeline: result.pipeline },
      });
    }

    // Log sourcing activity — fire and forget
    logSourcingActivity({
      recruiterId,
      requirementId,
      assignmentId: assignmentId ?? undefined,
      candidateServiceId,
      candidateEmail: email,
      candidateName: fullName,
    }).catch((err) =>
      console.error("[logSourcingActivity] failed (non-critical):", err)
    );

    return res.status(201).json({
      success: true,
      alreadyExists: false,
      message: "Candidate sourced successfully",
      data: { snapshot: result.snapshot, pipeline: result.pipeline },
    });
  } catch (err: any) {
    console.error("[sourceCandidateController]", err);

    if (err.message?.includes("No sourced pipeline stage found")) {
      return res.status(500).json({
        success: false,
        message: "Pipeline stage configuration error — contact admin",
      });
    }

    return res
      .status(500)
      .json({ success: false, message: "Failed to source candidate" });
  }
};

// =============================================================================
// MONITORING
// GET /api/internal-pool/activity?recruiterId=&requirementId=&from=&to=
// Manager view — who is using InternalPool vs going straight to Naukri
// =============================================================================

export const getActivitySummaryController = async (
  req: Request,
  res: Response
) => {
  try {
    const { recruiterId, requirementId, from, to } = req.query;

    const summary = await getInternalPoolActivitySummary({
      recruiterId: recruiterId as string | undefined,
      requirementId: requirementId as string | undefined,
      from: from as string | undefined,
      to: to as string | undefined,
    });

    return res.status(200).json({ success: true, data: summary });
  } catch (err: any) {
    console.error("[getActivitySummaryController]", err);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch activity summary" });
  }
};
