// ============================================================================
// Postgres-backed file storage (spec: uploads must survive ephemeral hosts).
// multer engine writes bytes straight into the UploadedFile table; the DB row
// key mirrors the public URL so callers keep using "/uploads/..." paths.
// ============================================================================
import { prisma } from "../config/database";

export type BlobKind = "public" | "private" | "chat";

const BLOB_PREFIXES: Record<BlobKind, string> = {
  public: "/uploads/",
  private: "/uploads/private/",
  chat: "/uploads/chat/",
};

export interface BlobRecord {
  key: string;
  filename: string;
  mimeType: string;
  size: number;
  data: Buffer;
}

export function blobUrlFor(kind: BlobKind, filename: string): string {
  return `${BLOB_PREFIXES[kind]}${filename}`;
}

/** Parse a "/uploads/..." URL back into its storage kind + filename. */
export function parseBlobUrl(url: string): { kind: BlobKind; filename: string } | null {
  if (!url.startsWith("/uploads/")) return null;
  for (const kind of ["private", "chat"] as const) {
    const prefix = `/uploads/${kind}/`;
    if (url.startsWith(prefix)) {
      return { kind, filename: url.slice(prefix.length) };
    }
  }
  return { kind: "public", filename: url.slice("/uploads/".length) };
}

function keyFromUrl(url: string): string | null {
  const parsed = parseBlobUrl(url);
  if (!parsed || !parsed.filename) return null;
  if (parsed.kind === "public") return parsed.filename;
  return `${parsed.kind}/${parsed.filename}`;
}

export async function saveBlob(payload: {
  kind: BlobKind;
  filename: string;
  originalname: string;
  mimeType: string;
  data: Buffer;
}): Promise<string> {
  const { kind, filename } = payload;
  const key = kind === "public" ? filename : `${kind}/${filename}`;
  await prisma.uploadedFile.create({
    data: {
      key,
      filename: payload.originalname,
      mimeType: payload.mimeType,
      size: payload.data.length,
      data: payload.data,
    },
  });
  return blobUrlFor(kind, filename);
}

export async function readBlob(url: string): Promise<BlobRecord | null> {
  const key = keyFromUrl(url);
  if (!key) return null;
  const row = await prisma.uploadedFile.findUnique({ where: { key } });
  if (!row) return null;
  return { key: row.key, filename: row.filename, mimeType: row.mimeType, size: row.size, data: row.data };
}

export async function removeBlob(url: string): Promise<void> {
  const key = keyFromUrl(url);
  if (!key) return;
  try {
    await prisma.uploadedFile.delete({ where: { key } });
  } catch {
    // Already gone — nothing to remove.
  }
}