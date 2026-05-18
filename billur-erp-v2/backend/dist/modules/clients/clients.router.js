"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const pool_1 = require("../../shared/database/pool");
const types_1 = require("../../shared/types");
const auth_1 = require("../../shared/middleware/auth");
const security_1 = require("../../shared/middleware/security");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
router.get('/', (0, auth_1.requirePermission)('clients.read'), async (req, res, next) => {
    try {
        const { rows } = await pool_1.pool.query(`
      SELECT c.*,
        (SELECT COUNT(*)::int FROM orders o WHERE o.client_id = c.id AND o.status IN ('active','problem') AND o.deleted_at IS NULL) AS active_orders,
        (SELECT COUNT(*)::int FROM orders o WHERE o.client_id = c.id AND o.status = 'completed' AND o.deleted_at IS NULL) AS completed_orders
      FROM clients c
      WHERE c.deleted_at IS NULL
      ORDER BY c.name
    `);
        res.json(rows);
    }
    catch (e) {
        next(e);
    }
});
router.post('/', (0, auth_1.requirePermission)('clients.create'), async (req, res, next) => {
    try {
        const { code, name, contact_person, phone, email, address, notes, pricing_type, default_pricing, services } = req.body || {};
        if (!code || !name)
            throw (0, types_1.BadRequest)('Kod va nom kerak');
        const dup = await pool_1.pool.query(`SELECT 1 FROM clients WHERE code = $1`, [code]);
        if (dup.rows.length)
            throw (0, types_1.Conflict)('Bu kod band');
        const { rows } = await pool_1.pool.query(`
      INSERT INTO clients (code, name, contact_person, phone, email, address, notes,
                           pricing_type, default_pricing, services)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *
    `, [code, name, contact_person || null, phone || null, email || null,
            address || null, notes || null, pricing_type || null,
            default_pricing ? JSON.stringify(default_pricing) : null,
            Array.isArray(services) ? services : null]);
        await (0, security_1.auditLog)({
            event_type: 'client.create',
            user_id: req.user.id, username: req.user.username,
            resource_type: 'client', resource_id: rows[0].id, action: 'create',
            after_value: rows[0], ip_address: (0, security_1.clientIp)(req)
        });
        res.json(rows[0]);
    }
    catch (e) {
        next(e);
    }
});
router.get('/:id', (0, auth_1.requirePermission)('clients.read'), async (req, res, next) => {
    try {
        const { rows } = await pool_1.pool.query(`SELECT * FROM clients WHERE id = $1 AND deleted_at IS NULL`, [req.params.id]);
        if (!rows.length)
            throw (0, types_1.NotFound)();
        res.json(rows[0]);
    }
    catch (e) {
        next(e);
    }
});
router.put('/:id', (0, auth_1.requirePermission)('clients.update'), async (req, res, next) => {
    try {
        const { name, contact_person, phone, email, address, notes, pricing_type, default_pricing, services, is_active } = req.body || {};
        const sel = await pool_1.pool.query(`SELECT * FROM clients WHERE id = $1 AND deleted_at IS NULL`, [req.params.id]);
        if (!sel.rows.length)
            throw (0, types_1.NotFound)();
        await pool_1.pool.query(`
      UPDATE clients SET
        name = COALESCE($1, name),
        contact_person = COALESCE($2, contact_person),
        phone = COALESCE($3, phone),
        email = COALESCE($4, email),
        address = COALESCE($5, address),
        notes = COALESCE($6, notes),
        pricing_type = COALESCE($7, pricing_type),
        default_pricing = COALESCE($8, default_pricing),
        services = COALESCE($9, services),
        is_active = COALESCE($10, is_active),
        updated_at = NOW()
      WHERE id = $11
    `, [name, contact_person, phone, email, address, notes, pricing_type,
            default_pricing ? JSON.stringify(default_pricing) : null,
            services, is_active, req.params.id]);
        await (0, security_1.auditLog)({
            event_type: 'client.update',
            user_id: req.user.id, username: req.user.username,
            resource_type: 'client', resource_id: req.params.id,
            before_value: sel.rows[0], after_value: req.body,
            ip_address: (0, security_1.clientIp)(req)
        });
        res.json({ ok: true });
    }
    catch (e) {
        next(e);
    }
});
router.delete('/:id', (0, auth_1.requirePermission)('clients.delete'), async (req, res, next) => {
    try {
        const sel = await pool_1.pool.query(`SELECT 1 FROM clients WHERE id = $1 AND deleted_at IS NULL`, [req.params.id]);
        if (!sel.rows.length)
            throw (0, types_1.NotFound)();
        const active = await pool_1.pool.query(`SELECT COUNT(*)::int AS c FROM orders WHERE client_id = $1 AND status IN ('active','problem') AND deleted_at IS NULL`, [req.params.id]);
        if (active.rows[0].c > 0)
            throw (0, types_1.BadRequest)('Klientda aktiv zakazlar bor, oldin yoping');
        await pool_1.pool.query(`UPDATE clients SET deleted_at = NOW(), is_active = false WHERE id = $1`, [req.params.id]);
        await (0, security_1.auditLog)({
            event_type: 'client.delete',
            user_id: req.user.id, username: req.user.username,
            resource_type: 'client', resource_id: req.params.id,
            ip_address: (0, security_1.clientIp)(req)
        });
        res.json({ ok: true });
    }
    catch (e) {
        next(e);
    }
});
router.get('/:id/orders', (0, auth_1.requirePermission)('clients.read'), async (req, res, next) => {
    try {
        const { rows } = await pool_1.pool.query(`
      SELECT id, order_type, external_code, status, deadline, total_pieces, created_at
      FROM orders
      WHERE client_id = $1 AND deleted_at IS NULL
      ORDER BY created_at DESC
    `, [req.params.id]);
        res.json(rows);
    }
    catch (e) {
        next(e);
    }
});
router.get('/:id/transactions', (0, auth_1.requirePermission)('clients.read'), async (req, res, next) => {
    try {
        const { rows } = await pool_1.pool.query(`
      SELECT * FROM client_transactions
      WHERE client_id = $1
      ORDER BY created_at DESC
      LIMIT 200
    `, [req.params.id]);
        res.json(rows);
    }
    catch (e) {
        next(e);
    }
});
router.post('/:id/transactions', (0, auth_1.requirePermission)('clients.update'), async (req, res, next) => {
    try {
        const { type, amount_uzs, description } = req.body || {};
        if (!type || typeof amount_uzs !== 'number')
            throw (0, types_1.BadRequest)('type va amount_uzs kerak');
        await pool_1.pool.query('BEGIN');
        const { rows } = await pool_1.pool.query(`
      INSERT INTO client_transactions (client_id, type, amount_uzs, description, created_by)
      VALUES ($1,$2,$3,$4,$5)
      RETURNING *
    `, [req.params.id, type, amount_uzs, description || null, req.user.id]);
        await pool_1.pool.query(`UPDATE clients SET balance_uzs = balance_uzs + $1 WHERE id = $2`, [amount_uzs, req.params.id]);
        await pool_1.pool.query('COMMIT');
        res.json(rows[0]);
    }
    catch (e) {
        await pool_1.pool.query('ROLLBACK').catch(() => { });
        next(e);
    }
});
exports.default = router;
//# sourceMappingURL=clients.router.js.map