import { Router } from "express";
import * as formSubmissionController from "../controllers/formSubmissionController";

const router = Router();

// Public on purpose: the landing pages mirror their replies here straight from
// the visitor's browser, so there is no session to authenticate. The defences
// are the honeypot field checked in the controller, the global rate limiter
// mounted in app.ts, and the per-field size caps - none of which need a user.
router.post("/", formSubmissionController.capture);

export default router;
