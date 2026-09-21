import { Router } from "express";
import { authenticateToken } from "../middleware/auth";
import { getPeople, getNearbyPartners } from "../controllers/discoveryController";

const router = Router();

router.get("/people", authenticateToken, getPeople);
router.get("/nearby-partners", authenticateToken, getNearbyPartners);

export default router;
