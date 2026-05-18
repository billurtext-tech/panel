"use strict";
/**
 * Box production service — ERP is source of truth for orders.
 * BoxUIApp reads orders here and records pack scans; never creates orders.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getOrderByCode = getOrderByCode;
exports.getOrderProgress = getOrderProgress;
exports.recordPackScan = recordPackScan;
exports.createBoxForOrder = createBoxForOrder;
exports.listActiveOrdersForBoxing = listActiveOrdersForBoxing;
const pool_1 = require("../../shared/database/pool");
const types_1 = require("../../shared/types");
const boxapp_service_1 = require("../boxapp/boxapp.service");
const sse_router_1 = require("../sse/sse.router");
async function getOrderByCode(externalCode) {
    const ord = await pool_1.pool.query(`
    SELECT o.id, o.external_code, o.status, c.name AS client_name
    FROM orders o
    LEFT JOIN clients c ON c.id = o.client_id
    WHERE o.external_code = $1 AND o.deleted_at IS NULL
  `, [externalCode.trim()]);
    if (!ord.rows.length)
        throw (0, types_1.NotFound)(`Zakaz topilmadi: ${externalCode}`);
    return buildOrderProgress(ord.rows[0].id);
}
async function getOrderProgress(orderId) {
    const ord = await pool_1.pool.query(`
    SELECT id FROM orders WHERE id = $1 AND deleted_at IS NULL
  `, [orderId]);
    if (!ord.rows.length)
        throw (0, types_1.NotFound)();
    return buildOrderProgress(orderId);
}
async function buildOrderProgress(orderId) {
    const meta = await pool_1.pool.query(`
    SELECT o.id, o.external_code, o.status, c.name AS client_name
    FROM orders o
    LEFT JOIN clients c ON c.id = o.client_id
    WHERE o.id = $1
  `, [orderId]);
    const items = await pool_1.pool.query(`
    SELECT oi.id, oi.ordered_qty, oi.boxed_qty,
           m.code AS model_code, m.name AS model_name,
           cl.code AS color_code, cl.name_uz AS color_name,
           s.code AS size_code
    FROM order_items oi
    LEFT JOIN models m ON m.id = oi.model_id
    LEFT JOIN colors cl ON cl.id = oi.color_id
    LEFT JOIN sizes s ON s.id = oi.size_id
    WHERE oi.order_id = $1
    ORDER BY m.code, cl.code, s.sort_order
  `, [orderId]);
    const boxes = await pool_1.pool.query(`
    SELECT uid, box_num, status, sizes, items, kg, created_at
    FROM boxes WHERE order_id = $1 OR zakaz = $2
    ORDER BY created_at DESC
  `, [orderId, meta.rows[0].external_code]);
    let totalOrdered = 0;
    let totalBoxed = 0;
    const progressItems = items.rows.map(row => {
        const ordered = Number(row.ordered_qty);
        const boxed = Number(row.boxed_qty);
        totalOrdered += ordered;
        totalBoxed += boxed;
        const remaining = Math.max(0, ordered - boxed);
        return {
            id: row.id,
            model_code: row.model_code,
            model_name: row.model_name,
            color_code: row.color_code,
            color_name: row.color_name,
            size_code: row.size_code,
            ordered_qty: ordered,
            boxed_qty: boxed,
            remaining_qty: remaining,
            is_complete: remaining <= 0,
        };
    });
    const totalRemaining = Math.max(0, totalOrdered - totalBoxed);
    const isComplete = totalRemaining === 0 && totalOrdered > 0;
    await pool_1.pool.query(`
    INSERT INTO order_production_summary (order_id, total_ordered, total_boxed, total_remaining, is_complete, completed_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, NOW())
    ON CONFLICT (order_id) DO UPDATE SET
      total_ordered = EXCLUDED.total_ordered,
      total_boxed = EXCLUDED.total_boxed,
      total_remaining = EXCLUDED.total_remaining,
      is_complete = EXCLUDED.is_complete,
      completed_at = CASE WHEN EXCLUDED.is_complete THEN COALESCE(order_production_summary.completed_at, NOW()) ELSE NULL END,
      updated_at = NOW()
  `, [orderId, totalOrdered, totalBoxed, totalRemaining, isComplete, isComplete ? new Date() : null]);
    if (isComplete) {
        await pool_1.pool.query(`
      UPDATE orders SET status = 'completed', updated_at = NOW()
      WHERE id = $1 AND status NOT IN ('completed','cancelled')
    `, [orderId]).catch(() => { });
    }
    return {
        order_id: orderId,
        external_code: meta.rows[0].external_code,
        status: meta.rows[0].status,
        client_name: meta.rows[0].client_name,
        total_ordered: totalOrdered,
        total_boxed: totalBoxed,
        total_remaining: totalRemaining,
        is_complete: isComplete,
        items: progressItems,
        boxes: boxes.rows,
    };
}
/** Scan/pack items into a box — validates size, prevents overproduction. */
async function recordPackScan(req) {
    const { order_code, size_code, quantity } = req;
    if (!order_code || !size_code)
        throw (0, types_1.BadRequest)('order_code va size_code kerak');
    if (!quantity || quantity < 1)
        throw (0, types_1.BadRequest)('quantity >= 1');
    return (0, pool_1.withTransaction)(async (client) => {
        const ord = await client.query(`
      SELECT o.id, o.external_code, o.status
      FROM orders o
      WHERE o.external_code = $1 AND o.deleted_at IS NULL
      FOR UPDATE
    `, [order_code.trim()]);
        if (!ord.rows.length)
            throw (0, types_1.NotFound)(`Zakaz topilmadi: ${order_code}`);
        if (ord.rows[0].status === 'cancelled')
            throw (0, types_1.Conflict)('Zakaz bekor qilingan');
        if (ord.rows[0].status === 'completed')
            throw (0, types_1.Conflict)('Zakaz allaqachon tugagan');
        const orderId = ord.rows[0].id;
        const item = await client.query(`
      SELECT oi.id, oi.ordered_qty, oi.boxed_qty, s.code AS size_code
      FROM order_items oi
      JOIN sizes s ON s.id = oi.size_id
      WHERE oi.order_id = $1 AND s.code = $2
      FOR UPDATE
    `, [orderId, size_code.trim()]);
        if (!item.rows.length) {
            await logScan(client, {
                order_id: orderId, size_code, quantity, req,
                result: 'invalid_size', message: `O'lcham zakazda yo'q: ${size_code}`,
            });
            throw (0, types_1.BadRequest)(`O'lcham bu zakazda yo'q: ${size_code}`);
        }
        const row = item.rows[0];
        const ordered = Number(row.ordered_qty);
        const boxed = Number(row.boxed_qty);
        const remaining = ordered - boxed;
        if (remaining <= 0) {
            await logScan(client, {
                order_id: orderId, order_item_id: row.id, size_code, quantity, req,
                result: 'overproduction', message: `${size_code} allaqachon to'liq`,
            });
            throw (0, types_1.Conflict)(`${size_code} uchun qolgan miqdor 0`);
        }
        if (quantity > remaining) {
            await logScan(client, {
                order_id: orderId, order_item_id: row.id, size_code, quantity, req,
                result: 'overproduction',
                message: `Faqat ${remaining} ta qolgan, ${quantity} so'raldi`,
            });
            throw (0, types_1.Conflict)(`${size_code}: maksimum ${remaining} ta qo'shish mumkin`);
        }
        // Duplicate barcode check
        if (req.barcode) {
            const dup = await client.query(`SELECT 1 FROM box_scan_events WHERE barcode = $1 AND result = 'ok'`, [req.barcode]);
            if (dup.rows.length) {
                await logScan(client, {
                    order_id: orderId, order_item_id: row.id, size_code, quantity, req,
                    result: 'duplicate', message: 'Barcode allaqachon scan qilingan',
                });
                throw (0, types_1.Conflict)('Bu barcode allaqachon ishlatilgan');
            }
        }
        await client.query(`
      UPDATE order_items SET boxed_qty = boxed_qty + $1 WHERE id = $2
    `, [quantity, row.id]);
        await logScan(client, {
            order_id: orderId, order_item_id: row.id, size_code, quantity, req,
            result: 'ok', message: `${quantity} ta ${size_code} qo'shildi`,
        });
        const progress = await buildOrderProgress(orderId);
        (0, sse_router_1.publishEvent)('box_scan', {
            order_id: orderId,
            order_code: ord.rows[0].external_code,
            size_code,
            quantity,
            remaining: progress.total_remaining,
        });
        return {
            ok: true,
            result: 'ok',
            message: `${quantity} ta ${size_code} muvaffaqiyatli`,
            progress,
            box_uid: req.box_uid,
        };
    });
}
async function logScan(client, opts) {
    await client.query(`
    INSERT INTO box_scan_events
      (order_id, order_item_id, box_uid, worker_id, user_id, barcode,
       size_code, quantity, scan_type, result, message, device_id, ip_address, idempotency_key)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pack',$9,$10,$11,$12,$13)
  `, [
        opts.order_id, opts.order_item_id || null,
        opts.req.box_uid || null, opts.req.worker_id || null, opts.req.user_id || null,
        opts.req.barcode || null, opts.size_code, opts.quantity,
        opts.result, opts.message, opts.req.device_id || null, opts.req.ip_address || null,
        opts.req.idempotency_key || null,
    ]);
}
/** Create a new box tied to ERP order — auto-generates UID if missing. */
async function createBoxForOrder(req) {
    const ord = await pool_1.pool.query(`
    SELECT o.id, o.external_code FROM orders o
    WHERE o.external_code = $1 AND o.deleted_at IS NULL
  `, [req.order_code.trim()]);
    if (!ord.rows.length)
        throw (0, types_1.NotFound)(`Zakaz topilmadi: ${req.order_code}`);
    const uid = req.uid || `BOX-${req.order_code}-${req.box_num}-${Date.now()}`;
    const dup = await pool_1.pool.query(`SELECT 1 FROM boxes WHERE uid = $1`, [uid]);
    if (dup.rows.length)
        throw (0, types_1.Conflict)('Bu UID band');
    const dupNum = await pool_1.pool.query(`SELECT 1 FROM boxes WHERE zakaz = $1 AND box_num = $2`, [req.order_code, req.box_num]);
    if (dupNum.rows.length)
        throw (0, types_1.Conflict)("Bu zakaz'da shu box raqami bor");
    const { rows } = await pool_1.pool.query(`
    INSERT INTO boxes
      (uid, box_num, zakaz, order_id, type, kg, status,
       model, color, sizes, items,
       created_by, created_by_name, created_date, status_history)
    VALUES ($1,$2,$3,$4,$5,$6,'packed',$7,$8,$9,$10,$11,$12,CURRENT_DATE,$13)
    RETURNING *
  `, [
        uid, req.box_num, req.order_code, ord.rows[0].id,
        req.type || 'simple', req.kg || 0,
        req.model || null, req.color || null,
        req.sizes ? JSON.stringify(req.sizes) : null,
        req.items ? JSON.stringify(req.items) : null,
        req.user_id, req.user_name,
        JSON.stringify([{ status: 'packed', at: new Date().toISOString(), by: req.user_name }]),
    ]);
    (0, boxapp_service_1.syncBoxCreate)(rows[0], req.user_id).catch(console.error);
    (0, sse_router_1.publishEvent)('box_created', { uid, order_code: req.order_code });
    return rows[0];
}
async function listActiveOrdersForBoxing(limit = 100) {
    const { rows } = await pool_1.pool.query(`
    SELECT o.id, o.external_code, o.status, o.total_pieces, o.deadline,
           c.name AS client_name,
           COALESCE(ops.total_boxed, 0) AS total_boxed,
           COALESCE(ops.total_remaining, o.total_pieces) AS total_remaining,
           COALESCE(ops.is_complete, false) AS is_complete
    FROM orders o
    LEFT JOIN clients c ON c.id = o.client_id
    LEFT JOIN order_production_summary ops ON ops.order_id = o.id
    WHERE o.deleted_at IS NULL
      AND o.status IN ('active', 'in_production', 'draft', 'pending')
      AND (ops.is_complete IS NULL OR ops.is_complete = false)
    ORDER BY o.priority DESC, o.deadline ASC NULLS LAST, o.created_at DESC
    LIMIT $1
  `, [limit]);
    return rows;
}
//# sourceMappingURL=box-production.service.js.map