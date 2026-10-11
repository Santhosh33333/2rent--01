import multer from "multer";
import path from "path";
import { env } from "../config/env";
import { blobStorageEngine } from "./blobUpload";

// uploads are persisted in Postgres (UploadedFile) — never on ephemeral disk.
const storage = blobStorageEngine("public");
const privateStorage = blobStorageEngine("private");

const IMAGE_EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/pjpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

// Accept a picked image when EITHER the filename extension or the MIME type is
// a known image type. The old test required both, but Android's Capacitor
// WebView frequently hands back a picked photo with a generic
// `application/octet-stream` (or empty) MIME, so a perfectly valid image was
// rejected as "only image files are allowed" - which read to users as "photo
// upload is broken". When the name has no image extension but the MIME does,
// the name is normalised so the stored blob keeps a servable extension.
// Exported for unit testing.
export const imageFilter = (_req: Express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (/jpeg|jpg|png|webp|gif/.test(ext)) {
    cb(null, true);
    return;
  }
  const mimeExt = IMAGE_EXT_BY_MIME[(file.mimetype || "").toLowerCase()];
  if (mimeExt) {
    file.originalname = `${file.originalname || "image"}${mimeExt}`;
    cb(null, true);
    return;
  }
  cb(new Error("Only image files are allowed (jpeg, jpg, png, webp, gif)."));
};

export const upload = multer({
  storage,
  fileFilter: imageFilter,
  limits: {
    fileSize: env.MAX_FILE_SIZE,
    files: 1,
  },
});

// Video uploads for feed posts. Same Postgres blob store as images; the only
// difference is the filter and a larger size cap. Adaptive/compressed/CDN
// delivery does not exist yet — the client is told the video is stored as-is.
const videoFilter = (_req: Express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowed = /mp4|mov|m4v|webm/;
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.test(ext) && /^video\//.test(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Only video files are allowed (mp4, mov, m4v, webm)."));
  }
};

export const videoUpload = multer({
  storage: blobStorageEngine("public"),
  fileFilter: videoFilter,
  limits: {
    fileSize: env.MAX_VIDEO_SIZE,
    files: 1,
  },
});

// KYC documents live under uploads/private and are only served through the
// authenticated access guard in middleware/fileAccess.ts — never publicly.
export const privateUpload = multer({
  storage: privateStorage,
  fileFilter: imageFilter,
  limits: {
    fileSize: env.MAX_FILE_SIZE,
    files: 1,
  },
});

export const uploadFields = multer({
  storage,
  fileFilter: imageFilter,
  limits: {
    fileSize: env.MAX_FILE_SIZE,
    files: 5,
  },
}).fields([
  { name: "selfie", maxCount: 1 },
  { name: "govId", maxCount: 1 },
  { name: "addressProof", maxCount: 1 },
]);

export function getUploadUrl(filename: string): string {
  return `/uploads/${filename}`;
}

/**
 * Bank statements: read into memory, never persisted.
 *
 * Deliberately NOT the blob storage the image uploads use. A statement lists
 * every transaction the business received, including the ones that are not
 * theirs yet and the names attached to them. Reconciliation needs the rows once
 * and keeps its own parsed copy; keeping the original file would mean holding
 * that data forever behind an admin URL for no benefit.
 *
 * `memoryStorage` is safe at this size because `limits.fileSize` caps it, and
 * the alternative - streaming to a temp file - would put the same bytes on disk
 * anyway, which is the thing being avoided here.
 */
export const statementUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.MAX_FILE_SIZE,
    files: 1,
  },
});