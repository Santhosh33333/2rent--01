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
  "image/bmp": ".bmp",
  "image/x-ms-bmp": ".bmp",
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
  // Anchored on purpose: an un-anchored `/jpeg|png/` also matched a name like
  // `report.scam-png.exe`, green-lighting a file the picker never offered.
  if (/^\.(jpe?g|png|webp|gif|bmp)$/.test(ext)) {
    cb(null, true);
    return;
  }
  const mimeExt = IMAGE_EXT_BY_MIME[(file.mimetype || "").toLowerCase()];
  if (mimeExt) {
    file.originalname = `${file.originalname || "image"}${mimeExt}`;
    cb(null, true);
    return;
  }
  cb(new Error("Only image files are allowed (jpeg, jpg, png, webp, gif, bmp)."));
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
// Mirrors the image filter: accept when the extension OR the MIME type is a
// known video type, and normalise the name so the stored blob keeps a
// servable extension. Requiring both rejected ordinary `.mp4` picks from
// Android, whose picker hands back `application/octet-stream`.
const VIDEO_EXT_BY_MIME: Record<string, string> = {
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/x-m4v": ".m4v",
  "video/webm": ".webm",
};

const videoFilter = (_req: Express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (/^\.(mp4|mov|m4v|webm)$/.test(ext)) {
    cb(null, true);
    return;
  }
  const mimeExt = VIDEO_EXT_BY_MIME[(file.mimetype || "").toLowerCase()];
  if (mimeExt) {
    file.originalname = `${file.originalname || "video"}${mimeExt}`;
    cb(null, true);
    return;
  }
  cb(new Error("Only video files are allowed (mp4, mov, m4v, webm)."));
};

export const videoUpload = multer({
  storage: blobStorageEngine("public"),
  fileFilter: videoFilter,
  limits: {
    fileSize: env.MAX_VIDEO_SIZE,
    files: 1,
  },
});

// Audio for listening rooms. Same storage and same "extension OR mime" rule as
// the image/video filters, because Android's picker hands back
// `application/octet-stream` for many ordinary `.mp3` picks. Audio shares the
// video cap: a full song is routinely larger than the 5 MB image cap, and the
// room can play a video too, so one bucket covers both.
const AUDIO_EXT_BY_MIME: Record<string, string> = {
  "audio/mpeg": ".mp3",
  "audio/mp3": ".mp3",
  "audio/mp4": ".m4a",
  "audio/x-m4a": ".m4a",
  "audio/aac": ".aac",
  "audio/ogg": ".ogg",
  "audio/opus": ".opus",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/flac": ".flac",
  "audio/x-flac": ".flac",
  "audio/webm": ".webm",
};

// Anchored, and the same set mediaUrl.ts accepts, so a file this filter stores
// can never be one the room then refuses to play.
const MEDIA_EXT = /^\.(mp3|m4a|aac|ogg|opus|wav|flac|mp4|mov|m4v|webm)$/;

export const mediaFilter = (_req: Express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (MEDIA_EXT.test(ext)) {
    cb(null, true);
    return;
  }
  const mime = (file.mimetype || "").toLowerCase();
  const mimeExt = AUDIO_EXT_BY_MIME[mime] ?? VIDEO_EXT_BY_MIME[mime];
  if (mimeExt) {
    file.originalname = `${file.originalname || "media"}${mimeExt}`;
    cb(null, true);
    return;
  }
  cb(new Error("Only audio or video files are allowed (mp3, m4a, aac, ogg, opus, wav, flac, mp4, mov, m4v, webm)."));
};

export const mediaUpload = multer({
  storage: blobStorageEngine("public"),
  fileFilter: mediaFilter,
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