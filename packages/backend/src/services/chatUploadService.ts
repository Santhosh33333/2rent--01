import crypto from "crypto";
import multer from "multer";
import path from "path";
import { blobStorageEngine } from "../middleware/blobUpload";

// ============================================================================
// Chat media uploads (spec 103: image + voice notes) — persisted in Postgres
// (UploadedFile), served ONLY through the authenticated media endpoint (never
// public static). Strict allowlist, size cap, uuid filenames.
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

export const chatUpload = multer({
  storage: blobStorageEngine("chat"),
  fileFilter: (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALL_EXTS.has(ext)) {
      cb(new Error("Only images (jpg/png/webp/gif) and voice notes (ogg/mp3/m4a/wav/webm) are allowed."));
      return;
    }
    cb(null, true);
  },
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

export interface ResolvedChatMedia {
  filename: string;
  kind: ChatMediaKind;
  mime: string;
}

/** Validate a stored mediaUrl; null when malformed/disallowed. */
export function resolveChatMedia(mediaUrl: string | null | undefined): ResolvedChatMedia | null {
  if (!mediaUrl || !mediaUrl.startsWith("/uploads/chat/")) return null;
  const filename = mediaUrl.slice("/uploads/chat/".length);
  if (!SAFE_NAME_RE.test(filename)) return null;
  const kind = classifyChatFile(filename);
  if (!kind) return null;
  const mime = MIME_BY_EXT[path.extname(filename).toLowerCase()] ?? "application/octet-stream";
  return { filename, kind, mime };
}