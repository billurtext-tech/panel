"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const query_1 = require("../../shared/utils/query");
const auth_1 = require("../../shared/middleware/auth");
const security_1 = require("../../shared/middleware/security");
const idempotency_1 = require("../../shared/middleware/idempotency");
const box_production_service_1 = require("./box-production.service");
const pool_1 = require("../../shared/database/pool");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
/** Orders available for BoxUI — read-only, never creates orders. */
router.get('/orders', (0, auth_1.requireAnyPermission)('boxapp.orders.read', 'orders.read'), async (_req, res, next) => {
    try {
        const rows = await (0, box_production_service_1.listActiveOrdersForBoxing)();
        res.json(rows);
    }
    catch (e) {
        next(e);
    }
});
router.get('/orders/by-code/:code', (0, auth_1.requireAnyPermission)('boxapp.orders.read', 'orders.read'), async (req, res, next) => {
    try {
        const progress = await (0, box_production_service_1.getOrderByCode)(req.params.code);
        res.json(progress);
    }
    catch (e) {
        next(e);
    }
});
router.get('/orders/:id/progress', (0, auth_1.requireAnyPermission)('boxapp.orders.read', 'orders.read'), async (req, res, next) => {
    try {
        const progress = await (0, box_production_service_1.getOrderProgress)(req.params.id);
        res.json(progress);
    }
    catch (e) {
        next(e);
    }
});
/** Pack scan — barcode/size validation, overproduction prevention. */
router.post('/scan', (0, auth_1.requireAnyPermission)('box.scan', 'box.create'), (0, security_1.rateLimit)(120, 60_000), (0, idempotency_1.idempotencyGuard)(), async (req, res, next) => {
    try {
        const workerRes = await pool_1.pool.query(`SELECT id FROM workers WHERE user_id = $1 AND deleted_at IS NULL`, [req.user.id]);
        const result = await (0, box_production_service_1.recordPackScan)({
            order_code: req.body?.order_code,
            size_code: req.body?.size_code,
            quantity: Number(req.body?.quantity) || 1,
            box_uid: req.body?.box_uid,
            barcode: req.body?.barcode,
            worker_id: req.body?.worker_id || workerRes.rows[0]?.id,
            user_id: req.user.id,
            device_id: req.body?.device_id,
            ip_address: (0, security_1.clientIp)(req),
            idempotency_key: req.headers['x-idempotency-key'],
        });
        res.json(result);
    }
    catch (e) {
        next(e);
    }
});
/** Create box for order (BoxUI packing station). */
router.post('/boxes', (0, auth_1.requirePermission)('box.create'), (0, security_1.rateLimit)(60, 60_000), (0, idempotency_1.idempotencyGuard)(), async (req, res, next) => {
    try {
        const box = await (0, box_production_service_1.createBoxForOrder)({
            order_code: req.body?.order_code,
            box_num: req.body?.box_num,
            uid: req.body?.uid,
            type: req.body?.type,
            kg: req.body?.kg,
            model: req.body?.model,
            color: req.body?.color,
            sizes: req.body?.sizes,
            items: req.body?.items,
            user_id: req.user.id,
            user_name: req.user.full_name,
        });
        res.json(box);
    }
    catch (e) {
        next(e);
    }
});
router.get('/scan-history', (0, auth_1.requirePermission)('box.read'), async (req, res, next) => {
    try {
        const order_id = (0, query_1.getOptionalQueryString)(req.query.order_id);
        const limit = (0, query_1.getQueryString)(req.query.limit) || '50';
        const params = [];
        let where = '1=1';
        if (order_id) {
            params.push(order_id);
            where += ` AND bse.order_id = $${params.length}`;
        }
        params.push(Math.min(Number(limit) || 50, 200));
        const { rows } = await pool_1.pool.query(`
      SELECT bse.*, o.external_code AS order_code, w.full_name AS worker_name
      FROM box_scan_events bse
      LEFT JOIN orders o ON o.id = bse.order_id
      LEFT JOIN workers w ON w.id = bse.worker_id
      WHERE ${where}
      ORDER BY bse.scanned_at DESC
      LIMIT $${params.length}
    `, params);
        res.json(rows);
    }
    catch (e) {
        next(e);
    }
});
exports.default = router;
//# sourceMappingURL=box-production.router.js.map