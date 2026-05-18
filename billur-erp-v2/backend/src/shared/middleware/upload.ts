// File upload middleware using multer with local disk storage.
// In production with multi-instance deploy, switch to S3-compatible storage.

import multer, { type FileFilterCallback } from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import type { Request } from 'express';

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.resolve(process.cwd(), 'uploads');

// Make sure base dirs exist
function ensureDir(p: string) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}
ensureDir(UPLOAD_DIR);
ensureDir(path.join(UPLOAD_DIR, 'workers'));

const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/png', 'image/webp',
  'application/pdf',
]);

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const storage = multer.diskStorage({
  destination: (_req: Request, _file: Express.Multer.File, cb: (error: Error | null, destination: string) => void) => {
    const dir = path.join(UPLOAD_DIR, 'workers');
    ensureDir(dir);
    cb(null, dir);
  },
  filename: (_req: Request, file: Express.Multer.File, cb: (error: Error | null, filename: string) => void) => {
    const ext = path.extname(file.originalname || '').toLowerCase().slice(0, 8);
    const rand = crypto.randomBytes(8).toString('hex');
    cb(null, `${Date.now()}-${rand}${ext}`);
  },
});

export const uploadDocument = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error('Faqat JPEG/PNG/WEBP/PDF qabul qilinadi'));
    }
    cb(null, true);
  },
}).single('file');

export function uploadDir() { return UPLOAD_DIR; }

/** Build a safe URL path for serving an uploaded file. */
export function fileUrl(absolutePath: string): string {
  const rel = path.relative(UPLOAD_DIR, absolutePath).replace(/\\/g, '/');
  return `/uploads/${rel}`;
}
