"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const pool_1 = require("../../shared/database/pool");
const types_1 = require("../../shared/types");
const auth_1 = require("../../shared/middleware/auth");
const security_1 = require("../../shared/middleware/security");
const query_1 = require("../../shared/utils/query");
const boxapp_service_1 = require("./boxapp.service");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
// ── Sync job queue inspection ────────────────────────────────────────────
router.get('/jobs', (0, auth_1.requirePermission)('boxapp.view'), async (req, res, next) => {
    try {
        const status = (0, query_1.getOptionalQueryString)(req.query.status);
        const entity_type = (0, query_1.getOptionalQueryString)(req.query.entity_type);
        const params = [];
        const conds = [];
        if (status) {
            params.push(status);
            conds.push(`sync_status = $${params.length}`);
        }
        if (entity_type) {
            params.push(entity_type);
            conds.push(`entity_type = $${params.length}`);
        }
        const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
        const { rows } = await pool_1.pool.query(`
      SELECT * FROM boxapp_sync_jobs
      ${where}
      ORDER BY created_at DESC
      LIMIT ${Math.min(parseInt((0, query_1.getQueryString)(req.query.limit) || '100', 10) || 100, 500)}
    `, params);
        res.json(rows);
    }
    catch (e) {
        next(e);
    }
});
router.get('/jobs/_stats', (0, auth_1.requirePermission)('boxapp.view'), async (req, res, next) => {
    try {
        const { rows } = await pool_1.pool.query(`
      SELECT sync_status, COUNT(*)::int AS count
      FROM boxapp_sync_jobs
      GROUP BY sync_status
    `);
        res.json(rows);
    }
    catch (e) {
        next(e);
    }
});
// ── Manual retry of a single job ─────────────────────────────────────────
router.post('/jobs/:id/retry', (0, auth_1.requirePermission)('boxapp.retry'), async (req, res, next) => {
    try {
        // Reset to pending immediately so it gets picked up
        await pool_1.pool.query(`
      UPDATE boxapp_sync_jobs SET sync_status = 'pending', next_retry_at = NOW()
      WHERE id = $1
    `, [req.params.id]);
        const ok = await (0, boxapp_service_1.processJob)(req.params.id);
        await (0, security_1.auditLog)({
            event_type: 'boxapp.retry',
            user_id: req.user.id, username: req.user.username,
            resource_type: 'boxapp_sync_job', resource_id: req.params.id,
            action: 'retry', metadata: { ok }, ip_address: (0, security_1.clientIp)(req),
        });
        res.json({ ok });
    }
    catch (e) {
        next(e);
    }
});
// ── Manual flush (process queue now) ─────────────────────────────────────
router.post('/jobs/_flush', (0, auth_1.requirePermission)('boxapp.sync'), async (req, res, next) => {
    try {
        const r = await (0, boxapp_service_1.processQueue)(50);
        await (0, security_1.auditLog)({
            event_type: 'boxapp.flush',
            user_id: req.user.id, username: req.user.username,
            resource_type: 'boxapp_sync_job', resource_id: 'queue',
            action: 'flush', metadata: r, ip_address: (0, security_1.clientIp)(req),
        });
        res.json(r);
    }
    catch (e) {
        next(e);
    }
});
// ── Cancel a stuck job ──────────────────────────────────────────────────
router.post('/jobs/:id/cancel', (0, auth_1.requirePermission)('boxapp.retry'), async (req, res, next) => {
    try {
        const r = await pool_1.pool.query(`
      UPDATE boxapp_sync_jobs SET sync_status = 'cancelled' WHERE id = $1
      RETURNING *
    `, [req.params.id]);
        if (!r.rowCount)
            throw (0, types_1.NotFound)();
        res.json(r.rows[0]);
    }
    catch (e) {
        next(e);
    }
});
exports.default = router;
//# sourceMappingURL=boxapp.router.js.map