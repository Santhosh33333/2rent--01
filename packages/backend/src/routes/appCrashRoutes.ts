import { Router } from "express";
import { reportAppCrash } from "../controllers/appCrashController";

const router = Router();

router.post("/crash-report", reportAppCrash);

export default router;