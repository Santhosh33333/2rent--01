// Serves uploaded files from Postgres (UploadedFile) for "/uploads/..." URLs.
// Mounted AFTER requireDocumentAccess so private KYC documents keep the
// ownership/admin guard, exactly like the old express.static setup did.
import { Request, Response } from "express";
import { readBlob } from "../services/blobStorage";
import { sendError } from "../utils/response";

export async function blobFileHandler(req: Request, res: Response): Promise<void> {
  try {
    // Inside a mount at /uploads, req.path is relative (e.g. "/private/x.jpg").
    const url = `/uploads${req.path}`;
    const blob = await readBlob(url);
    if (!blob) {
      sendError(res, "File not found.", 404, "NOT_FOUND");
      return;
    }
    const isPrivate = req.path.startsWith("/private/");
    res.setHeader("Content-Type", blob.mimeType);
    res.setHeader("Content-Length", String(blob.size));
    res.setHeader("ETag", `"${blob.key}-${blob.size}"`);
    // Private KYC media must not be cached by intermediaries; public files
    // (avatars) keep a long cache lifetime like the previous static server.
    res.setHeader("Cache-Control", isPrivate ? "private, no-store" : "public, max-age=604800");
    res.end(blob.data);
  } catch {
    sendError(res, "Failed to load file.", 500, "INTERNAL_ERROR");
  }
}