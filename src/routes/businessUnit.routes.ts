import { createBusinessUnit, getAllBusinessUnits, getBusinessUnitTree, updateBusinessUnit } from "@/controller/businessUnit.controller";
import { authenticateUser } from "@/middleware/auth";
import { authorize } from "@/middleware/role";
import { createBusinessUnitSchema, getBusinessUnitTreeSchema, updateBusinessUnitBodySchema, updateBusinessUnitParamsSchema } from "@/validators/businessUnit.validators";
import { validate } from "@/validators/validator";
import { Router } from "express";

const router = Router();


/**
 * @route   POST /api/business-units
 * @desc    Create new business unit
 * @access  Super Admin
 */
router.post(
    '/',
    authenticateUser,
    authorize('SUPER_ADMIN'),
    validate.body(createBusinessUnitSchema),
    createBusinessUnit)


/**
 * @route   GET /api/business-units
 * @desc    Get all business units
 * @access  Admin
 */
router.get(
    '/',
    authenticateUser,
    authorize('ADMIN'),
    getAllBusinessUnits
)

/**
 * @route   PATCH /api/business-units/:id
 * @desc    Update BU name or parent
 * @access  Super Admin
 */
router.patch(
    '/:id',
    authenticateUser,
    authorize('SUPER_ADMIN'),
    validate.params(updateBusinessUnitParamsSchema),
    validate.body(updateBusinessUnitBodySchema),
    updateBusinessUnit
)

/**
 * @route   GET /api/business-units/:id/tree
 * @desc    Get BU tree
 * @access  Admin
 */
router.get(
    '/:id/tree',
    authenticateUser,
    authorize('ADMIN'),
    validate.params(getBusinessUnitTreeSchema),
    getBusinessUnitTree
)

export default router