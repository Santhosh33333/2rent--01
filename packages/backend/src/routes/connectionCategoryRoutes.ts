import { Router } from "express";
import { authenticateToken } from "../middleware/auth";
import * as connectionCategoryController from "../controllers/connectionCategoryController";

/**
 * Public half of the connection catalogue: what modes exist and what they cost,
 * for a signed-in user about to send a connection request. Admin CRUD lives in
 * `adminRoutes.ts` under the PRICING section.
 */
const router = Router();
router.use(authenticateToken);

router.get("/", connectionCategoryController.getConnectionCategories);

export default router;
