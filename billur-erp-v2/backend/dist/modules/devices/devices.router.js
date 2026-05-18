"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const pool_1 = require("../../shared/database/pool");
const types_1 = require("../../shared/types");
const auth_1 = require("../../shared/middleware/auth");
const security_1 = require("../../shared/middleware/security");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
router.get('/', (0, auth_1.requirePermission)('settings.manage'), async (req, res, next) => {
    try {
        const { rows } = await pool_1.pool.query(`
      SELECT d.*, ps.name_uz AS stage_name, u.full_name AS approved_by_name
      FROM devices d
      LEFT JOIN production_stages ps ON ps.id = d.assigned_stage
      LEFT JOIN users u ON u.id = d.approved_by
      ORDER BY d.created_at DESC
    `);
        res.json(rows);
    }
    catch (e) {
        next(e);
    }
});
router.post('/register', async (req, res, next) => {
    try {
        const { id, name, type, fingerprint } = req.body || {};
        if (!id)
            throw (0, types_1.BadRequest)('id kerak');
        await pool_1.pool.query(`
      INSERT INTO devices (id, name, type, fingerprint, last_seen_at, is_approved)
      VALUES ($1, $2, $3, $4, NOW(), false)
      ON CONFLICT (id) DO UPDATE SET
        last_seen_at = NOW(),
        name        = COALESCE($2, devices.name),
        type        = COALESCE($3, devices.type),
        fingerprint = COALESCE($4, devices.fingerprint)
    `, [id, name || null, type || null, fingerprint || null]);
        res.json({ ok: true });
    }
    catch (e) {
        next(e);
    }
});
router.post('/:id/approve', (0, auth_1.requirePermission)('settings.manage'), async (req, res, next) => {
    try {
        const { assigned_stage } = req.body || {};
        const r = await pool_1.pool.query(`
      UPDATE devices SET
        is_approved = true,
        approved_by = $1,
        assigned_stage = COALESCE($2, assigned_stage)
      WHERE id = $3
      RETURNING *
    `, [req.user.id, assigned_stage || null, req.params.id]);
        if (!r.rowCount)
            throw (0, types_1.NotFound)();
        await (0, security_1.auditLog)({
            event_type: 'device.approve',
            user_id: req.user.id, username: req.user.username,
            resource_type: 'device', resource_id: req.params.id, action: 'approve',
            ip_address: (0, security_1.clientIp)(req)
        });
        res.json(r.rows[0]);
    }
    catch (e) {
        next(e);
    }
});
router.post('/:id/revoke', (0, auth_1.requirePermission)('settings.manage'), async (req, res, next) => {
    try {
        const r = await pool_1.pool.query(`
      UPDATE devices SET is_approved = false WHERE id = $1 RETURNING id
    `, [req.params.id]);
        if (!r.rowCount)
            throw (0, types_1.NotFound)();
        await (0, security_1.auditLog)({
            event_type: 'device.revoke',
            user_id: req.user.id, username: req.user.username,
            resource_type: 'device', resource_id: req.params.id, action: 'revoke',
            ip_address: (0, security_1.clientIp)(req)
        });
        res.json({ ok: true });
    }
    catch (e) {
        next(e);
    }
});
exports.default = router;
//# sourceMappingURL=devices.router.js.map