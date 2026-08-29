import express from "express";
import { authenticateToken, requireAdmin } from "../middleware/auth";
import { submitRoleApplication, getUserRoleApplications, getRoleApplications, getRoleApplication, approveRoleApplication, rejectRoleApplication } from "../controllers/roleApplicationsController";

const router = express.Router();

/**
 * @swagger
 * components:
 *   schemas:
 *     RoleApplicationCreate:
 *       type: object
 *       required:
 *         - role
 *         - data
 *       properties:
 *         role:
 *           type: string
 *           enum: [PARTNER]
 *         data:
 *           type: object
 *           description: Role-specific data including service area, bank details, documents
 */

/**
 * Submit a role application
 * @route POST /api/role-applications
 * @tags Role Applications
 * @param {object} request.body - Role application data
 * @param {string} request.body.role - Desired role (PARTNER)
 * @param {object} request.body.data - Role-specific data (service area, bank details, documents, etc.)
 * @returns {object} 201 - Application submitted successfully
 * @returns {object} 400 - Invalid request data
 * @returns {object} 409 - Duplicate application or already approved
 * @security BearerAuth
 */
router.post("/", authenticateToken, submitRoleApplication);

/**
 * Get user's role applications
 * @route GET /api/role-applications/my-apps
 * @tags Role Applications
 * @returns {array} 200 - Array of user's role applications
 * @security BearerAuth
 */
router.get("/my-apps", authenticateToken, getUserRoleApplications);

/**
 * Get all role applications (admin only)
 * @route GET /api/role-applications
 * @tags Role Applications
 * @param {string} [status] - Filter by status (PENDING, APPROVED, REJECTED)
 * @param {string} [role] - Filter by role type
 * @returns {array} 200 - Array of all role applications
 * @security BearerAuth
 * @security AdminAuth
 */
router.get("/", authenticateToken, requireAdmin, getRoleApplications);

/**
 * Get role application by ID
 * @route GET /api/role-applications/:id
 * @tags Role Applications
 * @param {string} id - Role application ID
 * @returns {object} 200 - Role application details
 * @returns {object} 403 - Access denied
 * @security BearerAuth
 */
router.get("/:id", authenticateToken, getRoleApplication);

/**
 * Approve role application (admin only)
 * @route PUT /api/role-applications/:id/approve
 * @tags Role Applications
 * @param {string} id - Role application ID
 * @param {string} request.body.reviewerId - Admin reviewer ID
 * @param {string} request.body.reviewerNotes - Optional reviewer notes
 * @returns {object} 200 - Application approved and user role updated
 * @returns {object} 400 - Invalid status or missing fields
 * @security BearerAuth
 * @security AdminAuth
 */
router.put("/:id/approve", authenticateToken, requireAdmin, approveRoleApplication);

/**
 * Reject role application (admin only)
 * @route PUT /api/role-applications/:id/reject
 * @tags Role Applications
 * @param {string} id - Role application ID
 * @param {string} request.body.reviewerId - Admin reviewer ID
 * @param {string} request.body.rejectionReason - Reason for rejection
 * @returns {object} 200 - Application rejected
 * @returns {object} 400 - Invalid status or missing fields
 * @security BearerAuth
 * @security AdminAuth
 */
router.put("/:id/reject", authenticateToken, requireAdmin, rejectRoleApplication);

export default router;
