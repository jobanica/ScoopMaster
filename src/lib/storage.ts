import "server-only";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { AppError } from "./errors";

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED: { mime: string; ext: string; magic: (b: Buffer) => boolean }[] = [
  { mime: "application/pdf", ext: "pdf", magic: (b) => b.subarray(0, 4).toString() === "%PDF" },
  { mime: "image/png", ext: "png", magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: "image/jpeg", ext: "jpg", magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/webp", ext: "webp", magic: (b) => b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP" },
];

export function uploadDir() {
  return path.resolve(process.env.UPLOAD_DIR ?? "./storage/uploads");
}

/** Validates type by magic bytes (not the client-supplied MIME), size, and stores under a random name outside /public. */
export async function storeUpload(file: File) {
  if (!file || file.size === 0) throw new AppError("Choose a file to upload.");
  if (file.size > MAX_BYTES) throw new AppError("Files must be 10 MB or smaller.");
  const buf = Buffer.from(await file.arrayBuffer());
  const type = ALLOWED.find((t) => t.magic(buf));
  if (!type) throw new AppError("Only PDF, PNG, JPEG and WEBP files are allowed.");
  const storedName = `${crypto.randomUUID()}.${type.ext}`;
  await fs.mkdir(uploadDir(), { recursive: true });
  await fs.writeFile(path.join(uploadDir(), storedName), buf, { mode: 0o600 });
  const safeName = file.name.replace(/[^\w.\- ()]/g, "_").slice(0, 150) || `file.${type.ext}`;
  return { storedName, mimeType: type.mime, sizeBytes: buf.length, sha256: crypto.createHash("sha256").update(buf).digest("hex"), fileName: safeName };
}

export async function readUpload(storedName: string) {
  if (!/^[0-9a-f-]{36}\.(pdf|png|jpg|webp)$/.test(storedName)) throw new AppError("Invalid file.");
  return fs.readFile(path.join(uploadDir(), storedName));
}
