// Custom multer storage engine that writes uploads into Postgres instead of
// the local disk, so files survive ephemeral host redeploys (Render wipes
// disk). diskStorage-compatible: it sets file.filename, file.path and file.size,
// so existing controllers that build "/uploads/..." URLs keep working.
import { randomUUID } from "crypto";
import path from "path";
import multer from "multer";
import { BlobKind, saveBlob } from "../services/blobStorage";

export function blobStorageEngine(kind: BlobKind): multer.StorageEngine {
  return {
    _handleFile(_req, file, cb) {
      const chunks: Buffer[] = [];
      file.stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      file.stream.on("error", (err) => cb(err));
      file.stream.on("end", () => {
        const data = Buffer.concat(chunks);
        const ext = path.extname(file.originalname).toLowerCase();
        const filename = `${randomUUID()}${ext}`;
        saveBlob({
          kind,
          filename,
          originalname: file.originalname,
          mimeType: file.mimetype || "application/octet-stream",
          data,
        })
          .then(() =>
            cb(null, {
              filename,
              path: kind === "public" ? `/uploads/${filename}` : `/uploads/${kind}/${filename}`,
              size: data.length,
            })
          )
          .catch((err) => cb(err as Error));
      });
    },
    _removeFile(_req, _file, cb) {
      cb(null);
    },
  };
}