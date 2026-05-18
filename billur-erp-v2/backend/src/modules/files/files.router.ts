// File upload routes — handles real multipart uploads for:
//   - Worker documents (passport, contract, certificate, ...)
//   - Worker photos
//
// Files are stored under UPLOAD_DIR (default /tmp/billur-uploads). In production
// this should be a persistent volume or S3.

import { Router, Response, NextFunction } from 'express';
import multer, { type FileFilterCallback } from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import type { Request } from 'express';
import { pool } from '../../shared/database/pool';
import { AuthRequest, BadRequest, NotFound, Forbidden } from '../../shared/types';
import { requireAuth, requirePermission } from '../../shared/middleware/auth';
import { auditLog, clientIp } from '../../shared/middleware/security';

const UPLOAD_DIR = process.env.UPLOAD_DIR || '/tmp/billur-uploads';

// Ensure upload dir exists
try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch {}
try { fs.mkdirSync(path.join(UPLOAD_DIR, 'workers'), { recursive: true }); } catch {}
try { fs.mkdirSync(path.join(UPLOAD_DIR, 'photos'), { recursive: true }); } catch {}
try { fs.mkdirSync(path.join(UPLOAD_DIR, 'quality'), { recursive: true }); } catch {}

// Multer storage — random filename, preserve extension
const storage = multer.diskStorage({
  destination: (req: Request, _file: Express.Multer.File, cb: (error: Error | null, destination: string) => void) => {
    const sub = (req.params.kind === 'photo') ? 'photos'
              : (req.params.kind === 'quality') ? 'quality'
              : 'workers';
    cb(null, path.join(UPLOAD_DIR, sub));
  },
  filename: (_req: Request, file: Express.Multer.File, cb: (error: Error | null, filename: string) => void) => {
    const rand = Math.random().toString(36).substring(2, 14);
    const ext = path.extname(file.originalname || '.bin').toLowerCase().substring(0, 8);
    cb(null, `${Date.now()}-${rand}${ext}`);
  },
});

const ALLOWED_MIMES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'application/pdf',
]);

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req: Request, file: Express.Multer.File, cb: FileFilterCallback) => {
    if (!ALLOWED_MIMES.has(file.mimetype)) {
      cb(new Error(`Fayl turi qabul qilinmaydi: ${file.mimetype}`));
      return;
    }
    cb(null, true);
  },
});

const router = Router();
router.use(requireAuth);

// ── Upload worker document ───────────────────────────────────────────────
// POST /api/files/worker/:workerId/document  (multipart with field "file")
router.post('/worker/:workerId/document',
  requirePermission('workers.documents.upload'),
  upload.single('file'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.file) throw BadRequest('Fayl yuborilmadi');

    const { document_type, issued_date, expiry_date, notes } = req.body || {};
    if (!document_type) throw BadRequest('document_type kerak');

    // Persistent relative path served by /api/files/download/...
    const relPath = path.relative(UPLOAD_DIR, req.file.path);

    const r = await pool.query(`
      INSERT INTO worker_documents
        (worker_id, document_type, file_name, file_path, file_size, mime_type,
         issued_date, expiry_date, notes, uploaded_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8::date, $9, $10)
      RETURNING *
    `, [
      req.params.workerId, document_type, req.file.originalname,
      relPath, req.file.size, req.file.mimetype,
      issued_date || null, expiry_date || null, notes || null, req.user!.id,
    ]);

    await auditLog({
      event_type: 'worker.document.upload',
      user_id: req.user!.id, username: req.user!.username,
      resource_type: 'worker_document', resource_id: r.rows[0].id,
      action: 'upload', metadata: {
        worker_id: req.params.workerId, document_type,
        file_name: req.file.originalname, size: req.file.size,
      },
      ip_address: clientIp(req),
    });

    res.json(r.rows[0]);
  } catch (e) { next(e); }
});

// ── Upload worker photo ──────────────────────────────────────────────────
router.post('/worker/:workerId/photo',
  upload.single('file'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.file) throw BadRequest('Fayl yuborilmadi');

    // Self or admin
    const sel = await pool.query(`SELECT user_id FROM workers WHERE id = $1`, [req.params.workerId]);
    if (!sel.rows.length) throw NotFound();
    const isAdmin = req.user!.permissions.includes('workers.update');
    const isSelf = sel.rows[0].user_id === req.user!.id;
    if (!isAdmin && !isSelf) throw Forbidden();

    const relPath = path.relative(UPLOAD_DIR, req.file.path);

    await pool.query(
      `UPDATE workers SET photo_url = $1, updated_at = NOW() WHERE id = $2`,
      [`/api/files/download/${relPath}`, req.params.workerId]
    );

    res.json({ ok: true, photo_url: `/api/files/download/${relPath}` });
  } catch (e) { next(e); }
});

// ── Quality photo (defect evidence) ──────────────────────────────────────
router.post('/quality/photo',
  requirePermission('quality.create'),
  upload.single('file'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.file) throw BadRequest('Fayl yuborilmadi');
    const relPath = path.relative(UPLOAD_DIR, req.file.path);
    res.json({
      ok: true,
      file_name: req.file.originalname,
      file_path: relPath,
      url: `/api/files/download/${relPath}`,
    });
  } catch (e) { next(e); }
});

// ── Serve uploaded files (with permission check) ─────────────────────────
router.get('/download/*',   async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const rel = req.params[0] as string;

    // Prevent path traversal
    const safeRel = rel.replace(/\.\./g, '').replace(/^\/+/, '');
    const abs = path.join(UPLOAD_DIR, safeRel);
    if (!abs.startsWith(UPLOAD_DIR)) throw Forbidden('Yo\'l ruxsat etilmagan');

    if (!fs.existsSync(abs)) throw NotFound('Fayl topilmadi');

    // Check permission for worker documents
    if (safeRel.startsWith('workers/')) {
      const docRow = await pool.query(
        `SELECT wd.worker_id, w.user_id
         FROM worker_documents wd LEFT JOIN workers w ON w.id = wd.worker_id
         WHERE wd.file_path = $1 LIMIT 1`,
        [safeRel]
      );
      if (docRow.rows.length) {
        const canViewAll = req.user!.permissions.includes('workers.documents.view_all');
        const isSelf = docRow.rows[0].user_id === req.user!.id;
        if (!canViewAll && !isSelf) throw Forbidden();
      }
    }

    res.sendFile(abs);
  } catch (e) { next(e); }
});

export default router;
