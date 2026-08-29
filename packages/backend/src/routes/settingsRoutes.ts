import { Router } from "express";
import { authenticateToken } from "../middleware/auth";
import * as settingsController from "../controllers/settingsController";

const router = Router();
router.use(authenticateToken);

router.get("/", settingsController.getSettings);
router.put("/", settingsController.updateSettings);

export default router;
