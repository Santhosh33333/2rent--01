import { Router } from "express";
import { authenticateToken } from "../middleware/auth";
import { getMyRoles, switchRole, applyForRole } from "../controllers/roleController";

const router = Router();

router.get("/my-roles", authenticateToken, getMyRoles);
router.post("/switch", authenticateToken, switchRole);
router.post("/apply", authenticateToken, applyForRole);

export default router;
