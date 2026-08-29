import { Router } from "express";
import { authenticateToken } from "../middleware/auth";
import { getDashboardStats } from "../controllers/dashboardController";

const router = Router();
router.get("/stats", authenticateToken, getDashboardStats);
router.get("/", authenticateToken, getDashboardStats);

export default router;
