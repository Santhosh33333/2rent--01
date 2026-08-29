import multer from "multer";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { env } from "../config/env";

const uploadDir = path.resolve(process.cwd(), env.UPLOAD_DIR);
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${randomUUID()}${ext}`);
  },
});

const privateUploadDir = path.join(uploadDir, "private");
if (!fs.existsSync(privateUploadDir)) {
  fs.mkdirSync(privateUploadDir, { recursive: true });
}

const privateStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, privateUploadDir);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${randomUUID()}${ext}`);
  },
});

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

// KYC documents land under uploads/private and are only served through the
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
  return `/${env.UPLOAD_DIR}/${filename}`;
}
