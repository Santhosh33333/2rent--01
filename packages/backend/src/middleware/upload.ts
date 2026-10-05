import multer from "multer";
import path from "path";
import { env } from "../config/env";
import { blobStorageEngine } from "./blobUpload";

// uploads are persisted in Postgres (UploadedFile) — never on ephemeral disk.
const storage = blobStorageEngine("public");
const privateStorage = blobStorageEngine("private");

const imageFilter = (_req: Express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowed = /jpeg|jpg|png|webp|gif/;
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.test(ext) && allowed.test(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Only image files are allowed (jpeg, jpg, png, webp, gif)."));
  }
};

export const upload = multer({
  storage,
  fileFilter: imageFilter,
  limits: {
    fileSize: env.MAX_FILE_SIZE,
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