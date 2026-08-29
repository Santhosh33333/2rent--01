import { Request, Response } from "express";
import { sendSuccess, sendError } from "../utils/response";
import * as locationIq from "../services/locationIqService";
import { AuthedRequest } from "../middleware/authTypes";

export async function forwardGeocode(req: Request, res: Response): Promise<void> {
  try {
    const { address, countryCodes, limit } = req.query;
    if (!address || typeof address !== "string") {
      sendError(res, "Address query parameter is required.", 400, "VALIDATION_ERROR");
      return;
    }
    const results = await locationIq.forwardGeocode(address, {
      countryCodes: countryCodes as string,
      limit: limit ? Number(limit) : undefined,
    });
    sendSuccess(res, { results }, "Geocoding results retrieved.");
  } catch (err: any) {
    sendError(res, err.message || "Geocoding failed.", 502, "LOCATIONIQ_ERROR");
  }
}

export async function reverseGeocode(req: Request, res: Response): Promise<void> {
  try {
    const lat = parseFloat(req.query.lat as string);
    const lon = parseFloat(req.query.lon as string);
    if (isNaN(lat) || isNaN(lon)) {
      sendError(res, "Valid lat and lon query parameters are required.", 400, "VALIDATION_ERROR");
      return;
    }
    const result = await locationIq.reverseGeocode(lat, lon);
    sendSuccess(res, { result }, "Reverse geocoding result retrieved.");
  } catch (err: any) {
    sendError(res, err.message || "Reverse geocoding failed.", 502, "LOCATIONIQ_ERROR");
  }
}

export async function autocompleteAddress(req: Request, res: Response): Promise<void> {
  try {
    const { q, countryCodes, lat, lon, limit } = req.query;
    if (!q || typeof q !== "string") {
      sendError(res, "Query parameter 'q' is required.", 400, "VALIDATION_ERROR");
      return;
    }
    const results = await locationIq.autocomplete(q, {
      countryCodes: countryCodes as string,
      lat: lat ? Number(lat) : undefined,
      lon: lon ? Number(lon) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
    sendSuccess(res, { results }, "Autocomplete results retrieved.");
  } catch (err: any) {
    sendError(res, err.message || "Autocomplete failed.", 502, "LOCATIONIQ_ERROR");
  }
}

export async function searchNearby(req: Request, res: Response): Promise<void> {
  try {
    const lat = parseFloat(req.query.lat as string);
    const lon = parseFloat(req.query.lon as string);
    if (isNaN(lat) || isNaN(lon)) {
      sendError(res, "Valid lat and lon query parameters are required.", 400, "VALIDATION_ERROR");
      return;
    }
    const { tag, radius, limit } = req.query;
    const results = await locationIq.nearbySearch(lat, lon, {
      tag: tag as string,
      radius: radius ? Number(radius) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
    sendSuccess(res, { results }, "Nearby search results retrieved.");
  } catch (err: any) {
    sendError(res, err.message || "Nearby search failed.", 502, "LOCATIONIQ_ERROR");
  }
}

export async function getRoute(req: Request, res: Response): Promise<void> {
  try {
    const { coordinates, alternative, steps } = req.body;
    if (!Array.isArray(coordinates) || coordinates.length < 2) {
      sendError(res, "At least 2 coordinates required in body.", 400, "VALIDATION_ERROR");
      return;
    }
    const result = await locationIq.calculateRoute(coordinates, {
      alternative: alternative as boolean,
      steps: steps as boolean,
    });
    sendSuccess(res, { result }, "Route calculated.");
  } catch (err: any) {
    sendError(res, err.message || "Route calculation failed.", 502, "LOCATIONIQ_ERROR");
  }
}

export async function getDistance(req: Request, res: Response): Promise<void> {
  try {
    const { coordinates } = req.body;
    if (!Array.isArray(coordinates) || coordinates.length < 2) {
      sendError(res, "At least 2 coordinates required in body.", 400, "VALIDATION_ERROR");
      return;
    }
    const result = await locationIq.calculateDistance(coordinates);
    sendSuccess(res, { result }, "Distance calculated.");
  } catch (err: any) {
    sendError(res, err.message || "Distance calculation failed.", 502, "LOCATIONIQ_ERROR");
  }
}

export async function getEta(req: Request, res: Response): Promise<void> {
  try {
    const { from, to } = req.body;
    if (!from || !to || typeof from.lat !== "number" || typeof from.lon !== "number" || typeof to.lat !== "number" || typeof to.lon !== "number") {
      sendError(res, "from and to objects with lat/lon numbers are required.", 400, "VALIDATION_ERROR");
      return;
    }
    const result = await locationIq.calculateETA(from, to);
    sendSuccess(res, { result }, "ETA calculated.");
  } catch (err: any) {
    sendError(res, err.message || "ETA calculation failed.", 502, "LOCATIONIQ_ERROR");
  }
}

export async function validateAddressEndpoint(req: Request, res: Response): Promise<void> {
  try {
    const { address } = req.query;
    if (!address || typeof address !== "string") {
      sendError(res, "Address query parameter is required.", 400, "VALIDATION_ERROR");
      return;
    }
    const result = await locationIq.validateAddress(address);
    sendSuccess(res, { result }, "Address validation result.");
  } catch (err: any) {
    sendError(res, err.message || "Address validation failed.", 502, "LOCATIONIQ_ERROR");
  }
}
