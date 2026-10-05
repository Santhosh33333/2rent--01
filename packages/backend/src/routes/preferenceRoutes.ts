import { Router } from "express";
import { body } from "express-validator";
import { authenticateToken } from "../middleware/auth";
import { validateRequest } from "../middleware/validation";
import * as preferenceController from "../controllers/preferenceController";

const router = Router();

/**
 * Preferences are not behind the KYC or paid-access gates that guard /dating.
 *
 * That is deliberate. A person should be able to say what they are looking for
 * before they pay or upload documents, and gating the form behind payment means the
 * first thing they see after subscribing is an empty screen. The gates still apply
 * where they matter - to the results.
 */
router.use(authenticateToken);

/**
 * Loose on purpose, strict in the service.
 *
 * Only shape is checked here (is this an array of strings, is this a number).
 * Whether an age is legal, whether a radius is one we offer and whether an
 * interest exists are catalogue questions, and expressing those as express-validator
 * chains would duplicate the rules in two places that could then disagree. The
 * service is the single authority and returns a per-field issue list.
 */
const shapeOnly = [
  body("distanceKm").optional({ nullable: true }),
  body("ageMin").optional({ nullable: true }),
  body("ageMax").optional({ nullable: true }),
  body("interests").optional().isArray().withMessage("Interests must be a list"),
  body("languages").optional().isArray().withMessage("Languages must be a list"),
  body("lifestyle")
    .optional()
    .custom((v: unknown) => {
      if (v === null || v === undefined) return true;
      return typeof v === "object" && !Array.isArray(v);
    })
    .withMessage("Lifestyle must be a group of categories"),
];

// GET /preferences
router.get("/", preferenceController.getPreferences);

// GET /preferences/options
router.get("/options", preferenceController.getOptions);

// PUT /preferences
router.put("/", shapeOnly, validateRequest, preferenceController.savePreferences);

// POST /preferences/location
router.post(
  "/location",
  [
    body("latitude").isFloat().withMessage("Latitude must be a number"),
    body("longitude").isFloat().withMessage("Longitude must be a number"),
  ],
  validateRequest,
  preferenceController.saveLocation,
);

// DELETE /preferences/location
router.delete("/location", preferenceController.clearLocation);

export default router;