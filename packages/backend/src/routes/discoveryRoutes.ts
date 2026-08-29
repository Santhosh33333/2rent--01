import { Router } from "express";
import { authenticateToken } from "../middleware/auth";
import { getPeople } from "../controllers/discoveryController";

const router = Router();

router.get("/people", authenticateToken, getPeople);

export default router;
