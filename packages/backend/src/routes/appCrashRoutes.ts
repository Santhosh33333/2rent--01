import { Router } from "express";
import { reportAppCrash } from "../controllers/appCrashController";

const router = Router();

router.post("/", reportAppCrash);

export default router;