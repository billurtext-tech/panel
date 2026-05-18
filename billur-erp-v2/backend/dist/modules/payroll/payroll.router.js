"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const pool_1 = require("../../shared/database/pool");
const types_1 = require("../../shared/types");
const auth_1 = require("../../shared/middleware/auth");
const security_1 = require("../../shared/middleware/security");
const query_1 = require("../../shared/utils/query");
const payroll_service_1 = require("./payroll.service");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
// ── Piece rates CRUD ─────────────────────────────────────────────────────
router.get('/rates', (0, auth_1.requirePermission)('piece_rates.read'), async (req, res, next) => {
    try {
        const { rows } = await pool_1.pool.query(`
      SELECT pr.*, m.code AS model_code, m.name AS model_name,
             ps.name_uz AS stage_name
      FROM piece_rates pr
      LEFT JOIN models m            ON m.id = pr.model_id
      LEFT JOIN production_stages ps ON ps.id = pr.stage
      WHERE pr.is_active = true
      ORDER BY pr.stage, m.code NULLS FIRST
    `);
        res.json(rows);
    }
    catch (e) {
        next(e);
    }
});
router.post('/rates', (0, auth_1.requirePermission)('piece_rates.update'), async (req, res, next) => {
    try {
        const { model_id, stage, operation_name, rate_per_piece, active_from } = req.body || {};
        if (!stage)
            throw (0, types_1.BadRequest)('stage kerak');
        const rate = Number(rate_per_piece);
        if (!Number.isFinite(rate) || rate < 0)
            throw (0, types_1.BadRequest)('rate_per_piece kerak');
        const r = await pool_1.pool.query(`
      INSERT INTO piece_rates
        (model_id, stage, operation_name, rate_per_piece, active_from, created_by)
      VALUES ($1, $2, $3, $4, COALESCE($5::date, CURRENT_DATE), $6)
      RETURNING *
    `, [model_id || null, stage, operation_name || null, rate,
            active_from || null, req.user.id]);
        await (0, security_1.auditLog)({
            event_type: 'piece_rates.create',
            user_id: req.user.id, username: req.user.username,
            resource_type: 'piece_rate', resource_id: r.rows[0].id,
            action: 'create', after_value: r.rows[0], ip_address: (0, security_1.clientIp)(req),
        });
        res.json(r.rows[0]);
    }
    catch (e) {
        next(e);
    }
});
router.put('/rates/:id', (0, auth_1.requirePermission)('piece_rates.update'), async (req, res, next) => {
    try {
        const { rate_per_piece, operation_name, is_active, active_to } = req.body || {};
        const r = await pool_1.pool.query(`
      UPDATE piece_rates SET
        rate_per_piece = COALESCE($1, rate_per_piece),
        operation_name = COALESCE($2, operation_name),
        is_active      = COALESCE($3, is_active),
        active_to      = COALESCE($4::date, active_to)
      WHERE id = $5
      RETURNING *
    `, [rate_per_piece, operation_name, is_active, active_to, req.params.id]);
        if (!r.rowCount)
            throw (0, types_1.NotFound)();
        await (0, security_1.auditLog)({
            event_type: 'piece_rates.update',
            user_id: req.user.id, username: req.user.username,
            resource_type: 'piece_rate', resource_id: req.params.id,
            action: 'update', after_value: r.rows[0], ip_address: (0, security_1.clientIp)(req),
        });
        res.json(r.rows[0]);
    }
    catch (e) {
        next(e);
    }
});
// ── Calculate single worker ──────────────────────────────────────────────
router.post('/calculate', (0, auth_1.requirePermission)('payroll.calculate'), async (req, res, next) => {
    try {
        const { worker_id, period_start, period_end } = req.body || {};
        const r = await (0, payroll_service_1.calculatePayroll)({
            worker_id, period_start, period_end, created_by: req.user.id,
        });
        await (0, security_1.auditLog)({
            event_type: 'payroll.calculate',
            user_id: req.user.id, username: req.user.username,
            resource_type: 'payroll_entry',
            resource_id: r.entry?.id || worker_id, action: 'calculate',
            metadata: { worker_id, period_start, period_end, scans_count: r.scans_count },
            ip_address: (0, security_1.clientIp)(req),
        });
        res.json(r);
    }
    catch (e) {
        next(e);
    }
});
// ── Calculate all workers for a period ───────────────────────────────────
router.post('/calculate-all', (0, auth_1.requirePermission)('payroll.calculate'), async (req, res, next) => {
    try {
        const { period_start, period_end } = req.body || {};
        if (!period_start || !period_end)
            throw (0, types_1.BadRequest)('period_start va period_end kerak');
        const r = await (0, payroll_service_1.calculateAllPayroll)({
            period_start, period_end, created_by: req.user.id,
        });
        await (0, security_1.auditLog)({
            event_type: 'payroll.calculate_all',
            user_id: req.user.id, username: req.user.username,
            resource_type: 'payroll_entry', resource_id: `${period_start}_${period_end}`,
            action: 'calculate_all',
            metadata: { workers_count: r.workers_count, period_start, period_end },
            ip_address: (0, security_1.clientIp)(req),
        });
        res.json(r);
    }
    catch (e) {
        next(e);
    }
});
// ── List payroll entries ─────────────────────────────────────────────────
router.get('/entries', async (req, res, next) => {
    try {
        // Worker can see only their own; admin can see all
        const canSeeAll = req.user.permissions.includes('payroll.view_all');
        if (!canSeeAll && !req.user.permissions.includes('payroll.view_own')) {
            throw (0, types_1.Forbidden)();
        }
        const worker_id = (0, query_1.getOptionalQueryString)(req.query.worker_id);
        const status = (0, query_1.getOptionalQueryString)(req.query.status);
        const period_start = (0, query_1.getOptionalQueryString)(req.query.period_start);
        const period_end = (0, query_1.getOptionalQueryString)(req.query.period_end);
        const params = [];
        const conds = [];
        if (!canSeeAll) {
            // Find worker linked to this user
            const w = await pool_1.pool.query(`SELECT id FROM workers WHERE user_id = $1`, [req.user.id]);
            if (!w.rows.length) {
                return res.json([]); // user is not a worker
            }
            params.push(w.rows[0].id);
            conds.push(`pe.worker_id = $${params.length}`);
        }
        else if (worker_id) {
            params.push(worker_id);
            conds.push(`pe.worker_id = $${params.length}`);
        }
        if (status) {
            params.push(status);
            conds.push(`pe.status = $${params.length}`);
        }
        if (period_start) {
            params.push(period_start);
            conds.push(`pe.period_start >= $${params.length}`);
        }
        if (period_end) {
            params.push(period_end);
            conds.push(`pe.period_end <= $${params.length}`);
        }
        const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
        const { rows } = await pool_1.pool.query(`
      SELECT pe.*, w.full_name AS worker_name, w.employee_code,
             u.full_name AS approved_by_name
      FROM payroll_entries pe
      LEFT JOIN workers w ON w.id = pe.worker_id
      LEFT JOIN users u   ON u.id = pe.approved_by
      ${where}
      ORDER BY pe.period_end DESC, pe.created_at DESC
      LIMIT 500
    `, params);
        res.json(rows);
    }
    catch (e) {
        next(e);
    }
});
// ── Single payroll detail ────────────────────────────────────────────────
router.get('/entries/:id', async (req, res, next) => {
    try {
        const canSeeAll = req.user.permissions.includes('payroll.view_all');
        const entry = await pool_1.pool.query(`
      SELECT pe.*, w.full_name AS worker_name, w.employee_code, w.user_id AS worker_user_id
      FROM payroll_entries pe LEFT JOIN workers w ON w.id = pe.worker_id
      WHERE pe.id = $1
    `, [req.params.id]);
        if (!entry.rows.length)
            throw (0, types_1.NotFound)();
        if (!canSeeAll && entry.rows[0].worker_user_id !== req.user.id) {
            throw (0, types_1.Forbidden)('Faqat o\'z payrollni ko\'rasiz');
        }
        const details = await pool_1.pool.query(`
      SELECT pd.*, m.code AS model_code, m.name AS model_name,
             o.external_code AS order_code, ps.name_uz AS stage_name,
             pqr.qr_code
      FROM payroll_details pd
      LEFT JOIN models m  ON m.id = pd.model_id
      LEFT JOIN orders o  ON o.id = pd.order_id
      LEFT JOIN production_stages ps ON ps.id = pd.stage
      LEFT JOIN production_qr_codes pqr ON pqr.id = pd.qr_code_id
      WHERE pd.payroll_entry_id = $1
      ORDER BY pd.finished_at DESC
    `, [req.params.id]);
        res.json({ entry: entry.rows[0], details: details.rows });
    }
    catch (e) {
        next(e);
    }
});
// ── Update bonus / penalty / advance ─────────────────────────────────────
router.patch('/entries/:id', (0, auth_1.requirePermission)('payroll.approve'), async (req, res, next) => {
    try {
        const { bonus_amount, penalty_amount, advance_amount, notes } = req.body || {};
        const r = await pool_1.pool.query(`
      UPDATE payroll_entries SET
        bonus_amount   = COALESCE($1, bonus_amount),
        penalty_amount = COALESCE($2, penalty_amount),
        advance_amount = COALESCE($3, advance_amount),
        notes          = COALESCE($4, notes),
        net_amount     = gross_amount + COALESCE($1, bonus_amount)
                       - COALESCE($2, penalty_amount) - COALESCE($3, advance_amount)
      WHERE id = $5 AND status = 'draft'
      RETURNING *
    `, [bonus_amount, penalty_amount, advance_amount, notes, req.params.id]);
        if (!r.rowCount)
            throw (0, types_1.NotFound)("Yangilanmadi (yo'q yoki draft emas)");
        await (0, security_1.auditLog)({
            event_type: 'payroll.update',
            user_id: req.user.id, username: req.user.username,
            resource_type: 'payroll_entry', resource_id: req.params.id,
            action: 'update', after_value: r.rows[0], ip_address: (0, security_1.clientIp)(req),
        });
        res.json(r.rows[0]);
    }
    catch (e) {
        next(e);
    }
});
// ── Approve payroll ──────────────────────────────────────────────────────
router.post('/entries/:id/approve', (0, auth_1.requirePermission)('payroll.approve'), async (req, res, next) => {
    try {
        const r = await pool_1.pool.query(`
      UPDATE payroll_entries
      SET status = 'approved', approved_by = $1, approved_at = NOW()
      WHERE id = $2 AND status = 'draft'
      RETURNING *
    `, [req.user.id, req.params.id]);
        if (!r.rowCount)
            throw (0, types_1.NotFound)();
        await (0, security_1.auditLog)({
            event_type: 'payroll.approve',
            user_id: req.user.id, username: req.user.username,
            resource_type: 'payroll_entry', resource_id: req.params.id,
            action: 'approve', ip_address: (0, security_1.clientIp)(req),
        });
        res.json(r.rows[0]);
    }
    catch (e) {
        next(e);
    }
});
router.post('/entries/:id/pay', (0, auth_1.requirePermission)('payroll.approve'), async (req, res, next) => {
    try {
        const r = await pool_1.pool.query(`
      UPDATE payroll_entries SET status = 'paid', paid_at = NOW()
      WHERE id = $1 AND status = 'approved'
      RETURNING *
    `, [req.params.id]);
        if (!r.rowCount)
            throw (0, types_1.NotFound)("Approved bo'lmagan payrollni to'lab bo'lmaydi");
        res.json(r.rows[0]);
    }
    catch (e) {
        next(e);
    }
});
exports.default = router;
//# sourceMappingURL=payroll.router.js.map