"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const pool_1 = require("../../shared/database/pool");
const crypto_1 = require("../../shared/utils/crypto");
const types_1 = require("../../shared/types");
const auth_1 = require("../../shared/middleware/auth");
const security_1 = require("../../shared/middleware/security");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
router.get('/', (0, auth_1.requirePermission)('users.read'), async (req, res, next) => {
    try {
        const { rows } = await pool_1.pool.query(`
      SELECT id, username, full_name, role_id, phone, email,
             is_active, last_login_at, created_at
      FROM users
      WHERE deleted_at IS NULL
      ORDER BY username
    `);
        res.json(rows);
    }
    catch (e) {
        next(e);
    }
});
router.post('/', (0, auth_1.requirePermission)('users.create'), async (req, res, next) => {
    try {
        const { username, password, role_id, full_name, phone, email } = req.body || {};
        if (!username || !password || !role_id || !full_name)
            throw (0, types_1.BadRequest)('Maydonlar to\'liq emas');
        if (!/^[a-zA-Z0-9_.-]{2,64}$/.test(username))
            throw (0, types_1.BadRequest)('Username noto\'g\'ri');
        if (typeof password !== 'string' || password.length < 6 || password.length > 128) {
            throw (0, types_1.BadRequest)('Parol 6-128 belgi');
        }
        const dup = await pool_1.pool.query(`SELECT 1 FROM users WHERE username = $1`, [username]);
        if (dup.rows.length)
            throw (0, types_1.Conflict)('Bu username band');
        const role = await pool_1.pool.query(`SELECT 1 FROM roles WHERE id = $1`, [role_id]);
        if (!role.rows.length)
            throw (0, types_1.BadRequest)('Noto\'g\'ri rol');
        const hash = await (0, crypto_1.hashPassword)(password);
        const { rows } = await pool_1.pool.query(`
      INSERT INTO users (username, password_hash, role_id, full_name, phone, email)
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING id, username, full_name, role_id, phone, email
    `, [username, hash, role_id, full_name, phone || null, email || null]);
        await (0, security_1.auditLog)({
            event_type: 'user.create',
            user_id: req.user.id, username: req.user.username,
            resource_type: 'user', resource_id: rows[0].id, action: 'create',
            after_value: rows[0], ip_address: (0, security_1.clientIp)(req)
        });
        res.json(rows[0]);
    }
    catch (e) {
        next(e);
    }
});
router.get('/:id', (0, auth_1.requirePermission)('users.read'), async (req, res, next) => {
    try {
        const { rows } = await pool_1.pool.query(`
      SELECT id, username, full_name, role_id, phone, email,
             is_active, last_login_at, created_at
      FROM users WHERE id = $1 AND deleted_at IS NULL
    `, [req.params.id]);
        if (!rows.length)
            throw (0, types_1.NotFound)();
        res.json(rows[0]);
    }
    catch (e) {
        next(e);
    }
});
router.put('/:id', (0, auth_1.requirePermission)('users.update'), async (req, res, next) => {
    try {
        const { full_name, phone, email, is_active, role_id } = req.body || {};
        const sel = await pool_1.pool.query(`SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL`, [req.params.id]);
        if (!sel.rows.length)
            throw (0, types_1.NotFound)();
        await pool_1.pool.query(`
      UPDATE users SET
        full_name = COALESCE($1, full_name),
        phone = COALESCE($2, phone),
        email = COALESCE($3, email),
        is_active = COALESCE($4, is_active),
        role_id = COALESCE($5, role_id),
        updated_at = NOW()
      WHERE id = $6
    `, [full_name, phone, email, is_active, role_id, req.params.id]);
        await (0, security_1.auditLog)({
            event_type: 'user.update',
            user_id: req.user.id, username: req.user.username,
            resource_type: 'user', resource_id: req.params.id, action: 'update',
            before_value: sel.rows[0], after_value: req.body,
            ip_address: (0, security_1.clientIp)(req)
        });
        res.json({ ok: true });
    }
    catch (e) {
        next(e);
    }
});
router.put('/:id/password', (0, auth_1.requirePermission)('users.update'), async (req, res, next) => {
    try {
        const { password } = req.body || {};
        if (!password || typeof password !== 'string' || password.length < 6 || password.length > 128) {
            throw (0, types_1.BadRequest)('Parol 6-128 belgi');
        }
        const hash = await (0, crypto_1.hashPassword)(password);
        const r = await pool_1.pool.query(`UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2 AND deleted_at IS NULL`, [hash, req.params.id]);
        if (!r.rowCount)
            throw (0, types_1.NotFound)();
        await pool_1.pool.query(`DELETE FROM sessions WHERE user_id = $1`, [req.params.id]);
        await (0, security_1.auditLog)({
            event_type: 'user.password_reset',
            user_id: req.user.id, username: req.user.username,
            resource_type: 'user', resource_id: req.params.id,
            ip_address: (0, security_1.clientIp)(req)
        });
        res.json({ ok: true });
    }
    catch (e) {
        next(e);
    }
});
router.delete('/:id', (0, auth_1.requirePermission)('users.delete'), async (req, res, next) => {
    try {
        const sel = await pool_1.pool.query(`SELECT username FROM users WHERE id = $1 AND deleted_at IS NULL`, [req.params.id]);
        if (!sel.rows.length)
            throw (0, types_1.NotFound)();
        if (sel.rows[0].username === 'admin')
            throw (0, types_1.BadRequest)('Admin o\'chirilmaydi');
        await pool_1.pool.query(`UPDATE users SET deleted_at = NOW(), is_active = false WHERE id = $1`, [req.params.id]);
        await pool_1.pool.query(`DELETE FROM sessions WHERE user_id = $1`, [req.params.id]);
        await (0, security_1.auditLog)({
            event_type: 'user.delete',
            user_id: req.user.id, username: req.user.username,
            resource_type: 'user', resource_id: req.params.id,
            ip_address: (0, security_1.clientIp)(req)
        });
        res.json({ ok: true });
    }
    catch (e) {
        next(e);
    }
});
router.get('/_meta/roles', (0, auth_1.requirePermission)('users.read'), async (req, res, next) => {
    try {
        const { rows } = await pool_1.pool.query(`SELECT * FROM roles ORDER BY id`);
        res.json(rows);
    }
    catch (e) {
        next(e);
    }
});
router.get('/_meta/permissions', (0, auth_1.requirePermission)('users.read'), async (req, res, next) => {
    try {
        const { rows } = await pool_1.pool.query(`SELECT * FROM permissions ORDER BY resource, action`);
        res.json(rows);
    }
    catch (e) {
        next(e);
    }
});
exports.default = router;
//# sourceMappingURL=users.router.js.map