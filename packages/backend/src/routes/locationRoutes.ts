import express from "express";
import { authenticateToken } from "../middleware/auth";
import {
  forwardGeocode,
  reverseGeocode,
  autocompleteAddress,
  searchNearby,
  getRoute,
  getDistance,
  getEta,
  validateAddressEndpoint,
} from "../controllers/locationController";

const router = express.Router();

router.get("/geocode", authenticateToken, forwardGeocode);
router.get("/reverse", authenticateToken, reverseGeocode);
router.get("/autocomplete", authenticateToken, autocompleteAddress);
router.get("/nearby", authenticateToken, searchNearby);
router.post("/route", authenticateToken, getRoute);
router.post("/distance", authenticateToken, getDistance);
router.post("/eta", authenticateToken, getEta);
router.get("/validate", authenticateToken, validateAddressEndpoint);

export default router;
