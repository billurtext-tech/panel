"use strict";
// File upload routes — handles real multipart uploads for:
//   - Worker documents (passport, contract, certificate, ...)
//   - Worker photos
//
// Files are stored under UPLOAD_DIR (default /tmp/billur-uploads). In production
// this should be a persistent volume or S3.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const node_path_1 = __importDefault(require("node:path"));
const node_fs_1 = __importDefault(require("node:fs"));
const pool_1 = require("../../shared/database/pool");
const types_1 = require("../../shared/types");
const auth_1 = require("../../shared/middleware/auth");
const security_1 = require("../../shared/middleware/security");
const UPLOAD_DIR = process.env.UPLOAD_DIR || '/tmp/billur-uploads';
// Ensure upload dir exists
try {
    node_fs_1.default.mkdirSync(UPLOAD_DIR, { recursive: true });
}
catch { }
try {
    node_fs_1.default.mkdirSync(node_path_1.default.join(UPLOAD_DIR, 'workers'), { recursive: true });
}
catch { }
try {
    node_fs_1.default.mkdirSync(node_path_1.default.join(UPLOAD_DIR, 'photos'), { recursive: true });
}
catch { }
try {
    node_fs_1.default.mkdirSync(node_path_1.default.join(UPLOAD_DIR, 'quality'), { recursive: true });
}
catch { }
// Multer storage — random filename, preserve extension
const storage = multer_1.default.diskStorage({
    destination: (req, _file, cb) => {
        const sub = (req.params.kind === 'photo') ? 'photos'
            : (req.params.kind === 'quality') ? 'quality'
                : 'workers';
        cb(null, node_path_1.default.join(UPLOAD_DIR, sub));
    },
    filename: (_req, file, cb) => {
        const rand = Math.random().toString(36).substring(2, 14);
        const ext = node_path_1.default.extname(file.originalname || '.bin').toLowerCase().substring(0, 8);
        cb(null, `${Date.now()}-${rand}${ext}`);
    },
});
const ALLOWED_MIMES = new Set([
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'application/pdf',
]);
const upload = (0, multer_1.default)({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
    fileFilter: (_req, file, cb) => {
        if (!ALLOWED_MIMES.has(file.mimetype)) {
            cb(new Error(`Fayl turi qabul qilinmaydi: ${file.mimetype}`));
            return;
        }
        cb(null, true);
    },
});
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
// ── Upload worker document ───────────────────────────────────────────────
// POST /api/files/worker/:workerId/document  (multipart with field "file")
router.post('/worker/:workerId/document', (0, auth_1.requirePermission)('workers.documents.upload'), upload.single('file'), async (req, res, next) => {
    try {
        if (!req.file)
            throw (0, types_1.BadRequest)('Fayl yuborilmadi');
        const { document_type, issued_date, expiry_date, notes } = req.body || {};
        if (!document_type)
            throw (0, types_1.BadRequest)('document_type kerak');
        // Persistent relative path served by /api/files/download/...
        const relPath = node_path_1.default.relative(UPLOAD_DIR, req.file.path);
        const r = await pool_1.pool.query(`
      INSERT INTO worker_documents
        (worker_id, document_type, file_name, file_path, file_size, mime_type,
         issued_date, expiry_date, notes, uploaded_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8::date, $9, $10)
      RETURNING *
    `, [
            req.params.workerId, document_type, req.file.originalname,
            relPath, req.file.size, req.file.mimetype,
            issued_date || null, expiry_date || null, notes || null, req.user.id,
        ]);
        await (0, security_1.auditLog)({
            event_type: 'worker.document.upload',
            user_id: req.user.id, username: req.user.username,
            resource_type: 'worker_document', resource_id: r.rows[0].id,
            action: 'upload', metadata: {
                worker_id: req.params.workerId, document_type,
                file_name: req.file.originalname, size: req.file.size,
            },
            ip_address: (0, security_1.clientIp)(req),
        });
        res.json(r.rows[0]);
    }
    catch (e) {
        next(e);
    }
});
// ── Upload worker photo ──────────────────────────────────────────────────
router.post('/worker/:workerId/photo', upload.single('file'), async (req, res, next) => {
    try {
        if (!req.file)
            throw (0, types_1.BadRequest)('Fayl yuborilmadi');
        // Self or admin
        const sel = await pool_1.pool.query(`SELECT user_id FROM workers WHERE id = $1`, [req.params.workerId]);
        if (!sel.rows.length)
            throw (0, types_1.NotFound)();
        const isAdmin = req.user.permissions.includes('workers.update');
        const isSelf = sel.rows[0].user_id === req.user.id;
        if (!isAdmin && !isSelf)
            throw (0, types_1.Forbidden)();
        const relPath = node_path_1.default.relative(UPLOAD_DIR, req.file.path);
        await pool_1.pool.query(`UPDATE workers SET photo_url = $1, updated_at = NOW() WHERE id = $2`, [`/api/files/download/${relPath}`, req.params.workerId]);
        res.json({ ok: true, photo_url: `/api/files/download/${relPath}` });
    }
    catch (e) {
        next(e);
    }
});
// ── Quality photo (defect evidence) ──────────────────────────────────────
router.post('/quality/photo', (0, auth_1.requirePermission)('quality.create'), upload.single('file'), async (req, res, next) => {
    try {
        if (!req.file)
            throw (0, types_1.BadRequest)('Fayl yuborilmadi');
        const relPath = node_path_1.default.relative(UPLOAD_DIR, req.file.path);
        res.json({
            ok: true,
            file_name: req.file.originalname,
            file_path: relPath,
            url: `/api/files/download/${relPath}`,
        });
    }
    catch (e) {
        next(e);
    }
});
// ── Serve uploaded files (with permission check) ─────────────────────────
router.get('/download/*', async (req, res, next) => {
    try {
        const rel = req.params[0];
        // Prevent path traversal
        const safeRel = rel.replace(/\.\./g, '').replace(/^\/+/, '');
        const abs = node_path_1.default.join(UPLOAD_DIR, safeRel);
        if (!abs.startsWith(UPLOAD_DIR))
            throw (0, types_1.Forbidden)('Yo\'l ruxsat etilmagan');
        if (!node_fs_1.default.existsSync(abs))
            throw (0, types_1.NotFound)('Fayl topilmadi');
        // Check permission for worker documents
        if (safeRel.startsWith('workers/')) {
            const docRow = await pool_1.pool.query(`SELECT wd.worker_id, w.user_id
         FROM worker_documents wd LEFT JOIN workers w ON w.id = wd.worker_id
         WHERE wd.file_path = $1 LIMIT 1`, [safeRel]);
            if (docRow.rows.length) {
                const canViewAll = req.user.permissions.includes('workers.documents.view_all');
                const isSelf = docRow.rows[0].user_id === req.user.id;
                if (!canViewAll && !isSelf)
                    throw (0, types_1.Forbidden)();
            }
        }
        res.sendFile(abs);
    }
    catch (e) {
        next(e);
    }
});
exports.default = router;
//# sourceMappingURL=files.router.js.map