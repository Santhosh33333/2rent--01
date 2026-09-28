import { Router } from "express";
import { body, param } from "express-validator";
import { authenticateToken, requireAdmin } from "../middleware/auth";
import { sanitizeInput, validateRequest } from "../middleware/validation";
import * as supportController from "../controllers/supportController";

const router = Router();

const ticketId = [param("id").isUUID(4)];

router.use(authenticateToken);

// ---------------------------------------------------------------------------
// Requester surface. Any signed-in user can raise a ticket about their own
// account; ownership is enforced in the service, not here, so the guarantee does
// not depend on this file staying as it is.
// ---------------------------------------------------------------------------
router.post(
  "/tickets",
  [body("category").notEmpty().trim(), body("subject").notEmpty().trim(), body("body").notEmpty().trim()],
  sanitizeInput,
  validateRequest,
  supportController.createSupportTicket
);

router.get("/tickets", supportController.listMySupportTickets);
router.get("/tickets/:id", ticketId, validateRequest, supportController.getMySupportTicket);

router.post(
  "/tickets/:id/replies",
  [...ticketId, body("body").notEmpty().trim()],
  sanitizeInput,
  validateRequest,
  supportController.replyToSupportTicket
);

router.patch(
  "/tickets/:id/status",
  [
    ...ticketId,
    body("status").notEmpty().trim(),
    // Required in practice for RESOLVED, which the service enforces, so a
    // client cannot clear the queue by flipping status alone.
    body("resolution").optional({ nullable: true }).isString().trim().isLength({ max: 8000 }),
  ],
  sanitizeInput,
  validateRequest,
  supportController.updateMySupportTicketStatus
);

// ---------------------------------------------------------------------------
// Staff surface. requireAdmin here is a second line of defence, not the only
// one: the service independently refuses non-staff priority/assignment changes,
// so a routing mistake cannot open these.
// ---------------------------------------------------------------------------
router.get("/queue", requireAdmin, supportController.listSupportQueue);

router.patch(
  "/tickets/:id/priority",
  requireAdmin,
  [...ticketId, body("priority").notEmpty().trim()],
  sanitizeInput,
  validateRequest,
  supportController.setSupportTicketPriority
);

router.patch(
  "/tickets/:id/assign",
  requireAdmin,
  [...ticketId, body("assigneeId").optional({ nullable: true })],
  sanitizeInput,
  validateRequest,
  supportController.assignSupportTicket
);

export default router;
