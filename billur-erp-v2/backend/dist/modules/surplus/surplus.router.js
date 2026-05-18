"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const pool_1 = require("../../shared/database/pool");
const types_1 = require("../../shared/types");
const auth_1 = require("../../shared/middleware/auth");
const security_1 = require("../../shared/middleware/security");
const query_1 = require("../../shared/utils/query");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
const VALID_STATUSES = ['in_warehouse', 'reserved', 'sold', 'discarded'];
router.get('/', (0, auth_1.requirePermission)('surplus.read'), async (req, res, next) => {
    try {
        const status = (0, query_1.getOptionalQueryString)(req.query.status);
        const model_id = (0, query_1.getOptionalQueryString)(req.query.model_id);
        const client_id = (0, query_1.getOptionalQueryString)(req.query.client_id);
        const params = [];
        const conds = [];
        if (status) {
            params.push(status);
            conds.push(`s.status = $${params.length}`);
        }
        if (model_id) {
            params.push(model_id);
            conds.push(`s.model_id = $${params.length}`);
        }
        if (client_id) {
            params.push(client_id);
            conds.push(`s.client_id = $${params.length}`);
        }
        const whereSql = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
        const { rows } = await pool_1.pool.query(`
      SELECT s.*,
             m.code AS model_code, m.name AS model_name,
             cl.name_uz AS color_name,
             sz.code AS size_code,
             c.name AS client_name, c.code AS client_code,
             so.external_code AS source_order_code
      FROM surplus_items s
      LEFT JOIN models m  ON m.id = s.model_id
      LEFT JOIN colors cl ON cl.id = s.color_id
      LEFT JOIN sizes sz  ON sz.id = s.size_id
      LEFT JOIN clients c ON c.id = s.client_id
      LEFT JOIN orders so ON so.id = s.source_order_id
      ${whereSql}
      ORDER BY s.arrived_at DESC, s.created_at DESC
      LIMIT 500
    `, params);
        res.json(rows);
    }
    catch (e) {
        next(e);
    }
});
router.post('/', (0, auth_1.requirePermission)('surplus.update'), async (req, res, next) => {
    try {
        const { source_order_id, source_item_id, client_id, model_id, color_id, size_id, qty, reason, has_top, has_bottom, notes, arrived_at } = req.body || {};
        if (!model_id || !color_id || !size_id) {
            throw (0, types_1.BadRequest)('model_id, color_id, size_id kerak');
        }
        if (!Number.isInteger(qty) || qty < 1)
            throw (0, types_1.BadRequest)("qty 1 dan katta bo'lishi kerak");
        const { rows } = await pool_1.pool.query(`
      INSERT INTO surplus_items
        (source_order_id, source_item_id, client_id,
         model_id, color_id, size_id, qty,
         reason, has_top, has_bottom, status, arrived_at, notes)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'in_warehouse',
              COALESCE($11::date, CURRENT_DATE), $12)
      RETURNING *
    `, [
            source_order_id || null, source_item_id || null, client_id || null,
            model_id, color_id, size_id, qty,
            reason || null,
            typeof has_top === 'boolean' ? has_top : null,
            typeof has_bottom === 'boolean' ? has_bottom : null,
            arrived_at || null, notes || null
        ]);
        await (0, security_1.auditLog)({
            event_type: 'surplus.create',
            user_id: req.user.id, username: req.user.username,
            resource_type: 'surplus_item', resource_id: rows[0].id, action: 'create',
            after_value: rows[0], ip_address: (0, security_1.clientIp)(req)
        });
        res.json(rows[0]);
    }
    catch (e) {
        next(e);
    }
});
router.put('/:id', (0, auth_1.requirePermission)('surplus.update'), async (req, res, next) => {
    try {
        const { status, notes, qty } = req.body || {};
        if (status && !VALID_STATUSES.includes(status)) {
            throw (0, types_1.BadRequest)(`status: ${VALID_STATUSES.join(', ')}`);
        }
        const sel = await pool_1.pool.query(`SELECT * FROM surplus_items WHERE id = $1`, [req.params.id]);
        if (!sel.rows.length)
            throw (0, types_1.NotFound)();
        if (sel.rows[0].status === 'sold' && status && status !== 'sold') {
            throw (0, types_1.Conflict)("Sotilgan mahsulot statusi qayta o'zgartirilmaydi");
        }
        await pool_1.pool.query(`
      UPDATE surplus_items SET
        status = COALESCE($1, status),
        notes  = COALESCE($2, notes),
        qty    = COALESCE($3, qty)
      WHERE id = $4
    `, [status || null, notes || null, qty || null, req.params.id]);
        await (0, security_1.auditLog)({
            event_type: 'surplus.update',
            user_id: req.user.id, username: req.user.username,
            resource_type: 'surplus_item', resource_id: req.params.id, action: 'update',
            before_value: sel.rows[0], after_value: req.body,
            ip_address: (0, security_1.clientIp)(req)
        });
        res.json({ ok: true });
    }
    catch (e) {
        next(e);
    }
});
router.post('/:id/sell', (0, auth_1.requirePermission)('surplus.sell'), async (req, res, next) => {
    try {
        const { client_id, sale_qty, sale_price_uzs, notes } = req.body || {};
        const qty = Number(sale_qty);
        if (!Number.isInteger(qty) || qty < 1) {
            throw (0, types_1.BadRequest)("sale_qty 1 dan katta bolishi kerak");
        }
        const result = await (0, pool_1.withTransaction)(async (client) => {
            const sel = await client.query(`SELECT * FROM surplus_items WHERE id = $1 FOR UPDATE`, [req.params.id]);
            if (!sel.rows.length)
                throw (0, types_1.NotFound)();
            const item = sel.rows[0];
            if (item.status !== 'in_warehouse' && item.status !== 'reserved') {
                throw (0, types_1.Conflict)(`Faqat 'in_warehouse'/'reserved' sotiladi (hozir: ${item.status})`);
            }
            if (qty > item.qty) {
                throw (0, types_1.BadRequest)(`Mavjud: ${item.qty}, sotilmoqchi: ${qty}`);
            }
            if (qty === item.qty) {
                await client.query(`
          UPDATE surplus_items
          SET status = 'sold', client_id = COALESCE($1, client_id),
              notes = COALESCE($2, notes)
          WHERE id = $3
        `, [client_id || null, notes || null, item.id]);
            }
            else {
                await client.query(`UPDATE surplus_items SET qty = qty - $1 WHERE id = $2`, [qty, item.id]);
                await client.query(`
          INSERT INTO surplus_items
            (source_order_id, source_item_id, client_id,
             model_id, color_id, size_id, qty,
             reason, has_top, has_bottom, status, arrived_at, notes)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'sold', CURRENT_DATE, $11)
        `, [
                    item.source_order_id, item.source_item_id, client_id || item.client_id,
                    item.model_id, item.color_id, item.size_id, qty,
                    item.reason, item.has_top, item.has_bottom,
                    notes || `Sotildi (asl: ${item.id})`
                ]);
            }
            await client.query(`
        INSERT INTO inventory_movements
          (warehouse_id, movement_type, reference_type, reference_id,
           model_id, color_id, size_id, qty, user_id, notes)
        VALUES ('surplus', 'issue', 'surplus_sale', $1, $2, $3, $4, $5, $6, $7)
      `, [
                item.id, item.model_id, item.color_id, item.size_id,
                -qty, req.user.id,
                `Izlishka sotildi: ${qty} ${sale_price_uzs ? `× ${sale_price_uzs} UZS` : ''}`
            ]);
            if (client_id && sale_price_uzs && Number(sale_price_uzs) > 0) {
                const totalSale = Number(sale_price_uzs) * qty;
                await client.query(`
          INSERT INTO client_transactions (client_id, type, amount_uzs, reference_id, description, created_by)
          VALUES ($1, 'surplus_sale', $2, $3, $4, $5)
        `, [
                    client_id, totalSale, item.id,
                    `Izlishka sotuv: ${qty} ta`, req.user.id
                ]);
                await client.query(`UPDATE clients SET balance_uzs = balance_uzs + $1 WHERE id = $2`, [totalSale, client_id]);
            }
            return { surplus_id: item.id, sold_qty: qty };
        });
        await (0, security_1.auditLog)({
            event_type: 'surplus.sell',
            user_id: req.user.id, username: req.user.username,
            resource_type: 'surplus_item', resource_id: req.params.id, action: 'sell',
            metadata: {
                qty,
                sale_price_uzs: sale_price_uzs ?? null,
                client_id: client_id ?? null,
            },
            ip_address: (0, security_1.clientIp)(req)
        });
        res.json(result);
    }
    catch (e) {
        next(e);
    }
});
router.get('/balance', (0, auth_1.requirePermission)('surplus.read'), async (req, res, next) => {
    try {
        const { rows } = await pool_1.pool.query(`
      SELECT s.model_id, m.code AS model_code, m.name AS model_name,
             s.color_id, cl.name_uz AS color_name,
             s.size_id, sz.code AS size_code,
             COALESCE(SUM(s.qty), 0)::int AS qty
      FROM surplus_items s
      LEFT JOIN models m  ON m.id = s.model_id
      LEFT JOIN colors cl ON cl.id = s.color_id
      LEFT JOIN sizes sz  ON sz.id = s.size_id
      WHERE s.status = 'in_warehouse'
      GROUP BY s.model_id, m.code, m.name,
               s.color_id, cl.name_uz,
               s.size_id, sz.code
      HAVING COALESCE(SUM(s.qty), 0) > 0
      ORDER BY m.code, cl.name_uz, sz.code
    `);
        res.json(rows);
    }
    catch (e) {
        next(e);
    }
});
exports.default = router;
//# sourceMappingURL=surplus.router.js.map