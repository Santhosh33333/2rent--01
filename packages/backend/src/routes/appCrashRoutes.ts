import { Router } from "express";
import { reportAppCrash, listAppCrashReports } from "../controllers/appCrashController";

const router = Router();

router.post("/", reportAppCrash);
router.get("/", listAppCrashReports);

export default router;