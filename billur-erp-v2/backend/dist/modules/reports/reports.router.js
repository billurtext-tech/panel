"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const exceljs_1 = __importDefault(require("exceljs"));
const pool_1 = require("../../shared/database/pool");
const auth_1 = require("../../shared/middleware/auth");
const security_1 = require("../../shared/middleware/security");
const query_1 = require("../../shared/utils/query");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
router.get('/worker-performance', (0, auth_1.requirePermission)('reports.read'), async (req, res, next) => {
    try {
        const since = (0, query_1.getOptionalQueryString)(req.query.since);
        const until = (0, query_1.getOptionalQueryString)(req.query.until);
        const params = [];
        const conds = [];
        if (since) {
            params.push(since);
            conds.push(`pe.occurred_at >= $${params.length}`);
        }
        if (until) {
            params.push(until);
            conds.push(`pe.occurred_at <= $${params.length}`);
        }
        const whereSql = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
        const { rows } = await pool_1.pool.query(`
      SELECT pe.worker_id, w.full_name AS worker_name, w.employee_code, w.position,
             pe.to_stage, ps.name_uz AS stage_name,
             COUNT(*)::int AS event_count,
             COALESCE(SUM(pe.qty), 0)::int AS total_qty
      FROM production_events pe
      LEFT JOIN workers w ON w.id = pe.worker_id
      LEFT JOIN production_stages ps ON ps.id = pe.to_stage
      ${whereSql}
      GROUP BY pe.worker_id, w.full_name, w.employee_code, w.position,
               pe.to_stage, ps.name_uz
      ORDER BY total_qty DESC
      LIMIT 500
    `, params);
        res.json(rows);
    }
    catch (e) {
        next(e);
    }
});
router.get('/clients-summary', (0, auth_1.requirePermission)('reports.read'), async (req, res, next) => {
    try {
        const { rows } = await pool_1.pool.query(`
      SELECT c.id, c.code, c.name, c.balance_uzs,
             (SELECT COUNT(*)::int FROM orders o
                WHERE o.client_id = c.id AND o.deleted_at IS NULL) AS total_orders,
             (SELECT COUNT(*)::int FROM orders o
                WHERE o.client_id = c.id AND o.deleted_at IS NULL
                  AND o.status IN ('active','problem')) AS active_orders,
             (SELECT COALESCE(SUM(o.total_pieces), 0)::int FROM orders o
                WHERE o.client_id = c.id AND o.deleted_at IS NULL) AS total_pieces
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
router.get('/daily-production', (0, auth_1.requirePermission)('reports.read'), async (req, res, next) => {
    try {
        const since = (0, query_1.getOptionalQueryString)(req.query.since);
        const until = (0, query_1.getOptionalQueryString)(req.query.until);
        const params = [];
        const conds = [];
        if (since) {
            params.push(since);
            conds.push(`pe.occurred_at >= $${params.length}`);
        }
        if (until) {
            params.push(until);
            conds.push(`pe.occurred_at <= $${params.length}`);
        }
        const whereSql = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
        const { rows } = await pool_1.pool.query(`
      SELECT DATE(pe.occurred_at) AS day,
             pe.to_stage,
             ps.name_uz AS stage_name,
             COUNT(*)::int AS event_count,
             COALESCE(SUM(pe.qty), 0)::int AS qty
      FROM production_events pe
      LEFT JOIN production_stages ps ON ps.id = pe.to_stage
      ${whereSql}
      GROUP BY DATE(pe.occurred_at), pe.to_stage, ps.name_uz
      ORDER BY day DESC, ps.sort_order
    `, params);
        res.json(rows);
    }
    catch (e) {
        next(e);
    }
});
router.get('/export/orders', (0, auth_1.requirePermission)('reports.export'), async (req, res, next) => {
    try {
        const { rows } = await pool_1.pool.query(`
      SELECT o.external_code, o.order_type, o.status,
             c.code AS client_code, c.name AS client_name,
             o.deadline, o.priority, o.total_pieces, o.notes,
             o.created_at,
             u.full_name AS created_by_name
      FROM orders o
      LEFT JOIN clients c ON c.id = o.client_id
      LEFT JOIN users u   ON u.id = o.created_by
      WHERE o.deleted_at IS NULL
      ORDER BY o.created_at DESC
      LIMIT 5000
    `);
        const wb = new exceljs_1.default.Workbook();
        const ws = wb.addWorksheet('Zakazlar');
        ws.columns = [
            { header: 'Kod', key: 'external_code', width: 14 },
            { header: 'Tur', key: 'order_type', width: 10 },
            { header: 'Status', key: 'status', width: 12 },
            { header: 'Klient kod', key: 'client_code', width: 12 },
            { header: 'Klient', key: 'client_name', width: 26 },
            { header: 'Deadline', key: 'deadline', width: 12 },
            { header: 'Priority', key: 'priority', width: 8 },
            { header: 'Mahsulot', key: 'total_pieces', width: 10 },
            { header: 'Eslatma', key: 'notes', width: 30 },
            { header: 'Yaratildi', key: 'created_at', width: 18 },
            { header: 'Kim', key: 'created_by_name', width: 18 }
        ];
        ws.getRow(1).font = { bold: true };
        rows.forEach(r => ws.addRow(r));
        await (0, security_1.auditLog)({
            event_type: 'reports.export',
            user_id: req.user.id, username: req.user.username,
            resource_type: 'report', resource_id: 'orders', action: 'export',
            metadata: { rows: rows.length },
            ip_address: (0, security_1.clientIp)(req)
        });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="orders-${new Date().toISOString().slice(0, 10)}.xlsx"`);
        await wb.xlsx.write(res);
        res.end();
    }
    catch (e) {
        next(e);
    }
});
router.get('/export/production', (0, auth_1.requirePermission)('reports.export'), async (req, res, next) => {
    try {
        const since = (0, query_1.getOptionalQueryString)(req.query.since);
        const until = (0, query_1.getOptionalQueryString)(req.query.until);
        const params = [];
        const conds = [];
        if (since) {
            params.push(since);
            conds.push(`pe.occurred_at >= $${params.length}`);
        }
        if (until) {
            params.push(until);
            conds.push(`pe.occurred_at <= $${params.length}`);
        }
        const whereSql = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
        const { rows } = await pool_1.pool.query(`
      SELECT pe.occurred_at, pe.to_stage, ps.name_uz AS stage_name, pe.qty,
             o.external_code AS order_code, o.order_type,
             m.code AS model_code, cl.name_uz AS color_name, sz.code AS size_code,
             w.full_name AS worker_name, w.employee_code,
             pe.notes
      FROM production_events pe
      LEFT JOIN production_stages ps ON ps.id = pe.to_stage
      LEFT JOIN orders o  ON o.id = pe.order_id
      LEFT JOIN order_items oi ON oi.id = pe.order_item_id
      LEFT JOIN models m  ON m.id = oi.model_id
      LEFT JOIN colors cl ON cl.id = oi.color_id
      LEFT JOIN sizes sz  ON sz.id = oi.size_id
      LEFT JOIN workers w ON w.id = pe.worker_id
      ${whereSql}
      ORDER BY pe.occurred_at DESC
      LIMIT 10000
    `, params);
        const wb = new exceljs_1.default.Workbook();
        const ws = wb.addWorksheet('Production');
        ws.columns = [
            { header: 'Vaqt', key: 'occurred_at', width: 18 },
            { header: 'Bosqich', key: 'stage_name', width: 14 },
            { header: 'Soni', key: 'qty', width: 8 },
            { header: 'Zakaz', key: 'order_code', width: 14 },
            { header: 'Tur', key: 'order_type', width: 10 },
            { header: 'Model', key: 'model_code', width: 12 },
            { header: 'Rang', key: 'color_name', width: 14 },
            { header: "O'lcham", key: 'size_code', width: 8 },
            { header: 'Ishchi', key: 'worker_name', width: 20 },
            { header: 'Tabel', key: 'employee_code', width: 10 },
            { header: 'Eslatma', key: 'notes', width: 30 }
        ];
        ws.getRow(1).font = { bold: true };
        rows.forEach(r => ws.addRow(r));
        await (0, security_1.auditLog)({
            event_type: 'reports.export',
            user_id: req.user.id, username: req.user.username,
            resource_type: 'report', resource_id: 'production', action: 'export',
            metadata: { rows: rows.length, since: since ?? null, until: until ?? null },
            ip_address: (0, security_1.clientIp)(req)
        });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="production-${new Date().toISOString().slice(0, 10)}.xlsx"`);
        await wb.xlsx.write(res);
        res.end();
    }
    catch (e) {
        next(e);
    }
});
router.get('/export/workers', (0, auth_1.requirePermission)('reports.export'), async (req, res, next) => {
    try {
        const since = (0, query_1.getOptionalQueryString)(req.query.since);
        const params = [];
        let whereSql = '';
        if (since) {
            params.push(since);
            whereSql = `WHERE pe.occurred_at >= $${params.length}`;
        }
        const { rows } = await pool_1.pool.query(`
      SELECT w.employee_code, w.full_name, w.position,
             ps.name_uz AS default_stage_name,
             COALESCE(stats.event_count, 0) AS event_count,
             COALESCE(stats.total_qty, 0) AS total_qty
      FROM workers w
      LEFT JOIN production_stages ps ON ps.id = w.default_stage
      LEFT JOIN (
        SELECT pe.worker_id,
               COUNT(*)::int AS event_count,
               COALESCE(SUM(pe.qty), 0)::int AS total_qty
        FROM production_events pe
        ${whereSql}
        GROUP BY pe.worker_id
      ) stats ON stats.worker_id = w.id
      WHERE w.deleted_at IS NULL
      ORDER BY total_qty DESC, w.full_name
    `, params);
        const wb = new exceljs_1.default.Workbook();
        const ws = wb.addWorksheet('Ishchilar');
        ws.columns = [
            { header: 'Tabel', key: 'employee_code', width: 10 },
            { header: 'F.I.O.', key: 'full_name', width: 26 },
            { header: 'Lavozim', key: 'position', width: 14 },
            { header: 'Bosqich', key: 'default_stage_name', width: 14 },
            { header: 'Events', key: 'event_count', width: 10 },
            { header: 'Jami soni', key: 'total_qty', width: 12 }
        ];
        ws.getRow(1).font = { bold: true };
        rows.forEach(r => ws.addRow(r));
        await (0, security_1.auditLog)({
            event_type: 'reports.export',
            user_id: req.user.id, username: req.user.username,
            resource_type: 'report', resource_id: 'workers', action: 'export',
            metadata: { rows: rows.length, since: since ?? null },
            ip_address: (0, security_1.clientIp)(req)
        });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="workers-${new Date().toISOString().slice(0, 10)}.xlsx"`);
        await wb.xlsx.write(res);
        res.end();
    }
    catch (e) {
        next(e);
    }
});
// Payroll Excel export
router.get('/export/payroll', (0, auth_1.requirePermission)('reports.export'), async (req, res, next) => {
    try {
        const periodStart = (0, query_1.getOptionalQueryString)(req.query.period_start);
        const periodEnd = (0, query_1.getOptionalQueryString)(req.query.period_end);
        if (!periodStart || !periodEnd) {
            return res.status(400).json({ error: 'period_start va period_end kerak' });
        }
        const { rows } = await pool_1.pool.query(`
      SELECT pe.*, w.full_name AS worker_name, w.employee_code,
             ps.name_uz AS stage_name
      FROM payroll_entries pe
      LEFT JOIN workers w ON w.id = pe.worker_id
      LEFT JOIN production_stages ps ON ps.id = w.default_stage
      WHERE pe.period_start >= $1 AND pe.period_end <= $2
      ORDER BY w.full_name
    `, [periodStart, periodEnd]);
        const wb = new exceljs_1.default.Workbook();
        wb.creator = 'BILLUR ERP';
        wb.created = new Date();
        const ws = wb.addWorksheet('Payroll');
        ws.addRow(['BILLUR ERP — Oylik hisoboti']).font = { bold: true, size: 14 };
        ws.addRow([`Davr: ${periodStart} — ${periodEnd}`]);
        ws.addRow([`Eksport: ${new Date().toLocaleString('uz-UZ')}`]);
        ws.addRow([]);
        const header = ws.addRow([
            'Tabel', 'F.I.O.', 'Bosqich', 'Qty', 'Gross (UZS)',
            'Bonus', 'Penalty', 'Advance', 'Net (UZS)', 'Status'
        ]);
        header.font = { bold: true };
        header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
        for (const r of rows) {
            ws.addRow([
                r.employee_code || '',
                r.worker_name || '',
                r.stage_name || '',
                Number(r.total_quantity),
                Number(r.gross_amount),
                Number(r.bonus_amount),
                Number(r.penalty_amount),
                Number(r.advance_amount),
                Number(r.net_amount),
                r.status,
            ]);
        }
        // Totals row
        const totalRow = ws.addRow([
            '', 'JAMI', '',
            rows.reduce((s, r) => s + Number(r.total_quantity), 0),
            rows.reduce((s, r) => s + Number(r.gross_amount), 0),
            rows.reduce((s, r) => s + Number(r.bonus_amount), 0),
            rows.reduce((s, r) => s + Number(r.penalty_amount), 0),
            rows.reduce((s, r) => s + Number(r.advance_amount), 0),
            rows.reduce((s, r) => s + Number(r.net_amount), 0),
            '',
        ]);
        totalRow.font = { bold: true };
        // Column widths
        ws.columns.forEach((c, i) => { c.width = [12, 28, 14, 8, 14, 12, 12, 12, 14, 12][i] || 12; });
        // Number formatting for money columns
        [5, 6, 7, 8, 9].forEach(col => {
            ws.getColumn(col).numFmt = '#,##0';
        });
        await (0, security_1.auditLog)({
            event_type: 'reports.export',
            user_id: req.user.id, username: req.user.username,
            resource_type: 'report', resource_id: 'payroll', action: 'export',
            metadata: {
                rows: rows.length,
                periodStart: periodStart ?? null,
                periodEnd: periodEnd ?? null,
            },
            ip_address: (0, security_1.clientIp)(req),
        });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="payroll-${periodStart}_${periodEnd}.xlsx"`);
        await wb.xlsx.write(res);
        res.end();
    }
    catch (e) {
        next(e);
    }
});
// Quality defects export
router.get('/export/quality', (0, auth_1.requirePermission)('reports.export'), async (req, res, next) => {
    try {
        const since = (0, query_1.getOptionalQueryString)(req.query.since);
        const until = (0, query_1.getOptionalQueryString)(req.query.until);
        const params = [];
        const conds = [];
        if (since) {
            params.push(since);
            conds.push(`qd.created_at >= $${params.length}::date`);
        }
        if (until) {
            params.push(until);
            conds.push(`qd.created_at < ($${params.length}::date + INTERVAL '1 day')`);
        }
        const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
        const { rows } = await pool_1.pool.query(`
      SELECT qd.*, w.full_name AS checked_by_name,
             rw.full_name AS responsible_worker_name,
             pqr.qr_code, o.external_code AS order_code,
             m.code AS model_code
      FROM quality_decisions qd
      LEFT JOIN workers w  ON w.id = qd.checked_by
      LEFT JOIN workers rw ON rw.id = qd.responsible_worker_id
      LEFT JOIN production_qr_codes pqr ON pqr.id = qd.qr_code_id
      LEFT JOIN orders o   ON o.id = pqr.order_id
      LEFT JOIN models m   ON m.id = pqr.model_id
      ${where}
      ORDER BY qd.created_at DESC
    `, params);
        const wb = new exceljs_1.default.Workbook();
        const ws = wb.addWorksheet('Quality');
        ws.addRow(['BILLUR ERP — Quality hisoboti']).font = { bold: true, size: 14 };
        if (since || until)
            ws.addRow([`Davr: ${since || ''} — ${until || ''}`]);
        ws.addRow([]);
        const header = ws.addRow([
            'Sana', 'QR', 'Zakaz', 'Model', 'Qaror',
            'Defekt turi', 'Tavsif', 'Soni', 'Aybi bosqich',
            'Aybi ishchi', 'QC',
        ]);
        header.font = { bold: true };
        header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
        for (const r of rows) {
            ws.addRow([
                new Date(r.created_at).toLocaleString('uz-UZ', { hour12: false }),
                r.qr_code || '',
                r.order_code || '',
                r.model_code || '',
                r.decision,
                r.defect_type || '',
                r.description || '',
                Number(r.quantity_affected),
                r.responsible_stage || '',
                r.responsible_worker_name || '',
                r.checked_by_name || '',
            ]);
        }
        ws.columns.forEach((c, i) => { c.width = [20, 22, 16, 12, 10, 18, 28, 8, 14, 18, 18][i] || 12; });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="quality-${new Date().toISOString().slice(0, 10)}.xlsx"`);
        await wb.xlsx.write(res);
        res.end();
    }
    catch (e) {
        next(e);
    }
});
exports.default = router;
//# sourceMappingURL=reports.router.js.map