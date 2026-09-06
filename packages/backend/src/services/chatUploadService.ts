import crypto from "crypto";
import fs from "fs";
import multer from "multer";
import path from "path";

// ============================================================================
// Chat media uploads (spec 103: image + voice notes) — real files on disk
// under uploads/chat/, served ONLY through the authenticated media endpoint
// (never public static). Strict allowlist, size cap, uuid filenames.
//
// NOTE: the upload root is read lazily (not at import time) so this module
// never crashes on import when env is unvalidated (tests, tooling).
// ============================================================================

export const CHAT_UPLOAD_DIR = "chat";

const ALLOWED: Record<string, string[]> = {
  image: [".jpg", ".jpeg", ".png", ".webp", ".gif"],
  audio: [".ogg", ".oga", ".mp3", ".m4a", ".wav", ".webm"],
};
const ALL_EXTS = new Set([...ALLOWED.image, ...ALLOWED.audio]);

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".webm": "audio/webm",
};

function uploadRoot(): string {
  return process.env.UPLOAD_DIR ?? "uploads";
}

function chatDir(): string {
  const dir = path.resolve(process.cwd(), uploadRoot(), CHAT_UPLOAD_DIR);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, chatDir()),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

function fileFilter(_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback): void {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALL_EXTS.has(ext)) {
    cb(new Error("Only images (jpg/png/webp/gif) and voice notes (ogg/mp3/m4a/wav/webm) are allowed."));
    return;
  }
  cb(null, true);
}

export const chatUpload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

export type ChatMediaKind = "IMAGE" | "VOICE";

/** Classify an uploaded filename; null when not an allowed chat file. */
export function classifyChatFile(filename: string): ChatMediaKind | null {
  const ext = path.extname(filename).toLowerCase();
  if (ALLOWED.image.includes(ext)) return "IMAGE";
  if (ALLOWED.audio.includes(ext)) return "VOICE";
  return null;
}

const SAFE_NAME_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]+$/i;

/** Resolve a stored mediaUrl to a disk path; null when malformed/missing. */
export function resolveChatMedia(mediaUrl: string | null | undefined): { abs: string; kind: ChatMediaKind; mime: string } | null {
  if (!mediaUrl || !mediaUrl.startsWith("/uploads/chat/")) return null;
  const filename = mediaUrl.slice("/uploads/chat/".length);
  if (!SAFE_NAME_RE.test(filename)) return null;
  const kind = classifyChatFile(filename);
  if (!kind) return null;
  const abs = path.resolve(process.cwd(), uploadRoot(), CHAT_UPLOAD_DIR, filename);
  if (!abs.startsWith(chatDir())) return null;
  if (!fs.existsSync(abs)) return null;
  const mime = MIME_BY_EXT[path.extname(filename).toLowerCase()] ?? "application/octet-stream";
  return { abs, kind, mime };
}
