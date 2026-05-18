import { Router, Response, NextFunction } from 'express';
import { AuthRequest } from '../../shared/types';
import { requireAuth, requirePermission, requireAnyPermission } from '../../shared/middleware/auth';
import { clientIp, rateLimit } from '../../shared/middleware/security';
import { idempotencyGuard } from '../../shared/middleware/idempotency';
import {
  getOrderByCode, getOrderProgress, recordPackScan,
  createBoxForOrder, listActiveOrdersForBoxing,
} from './box-production.service';
import { pool } from '../../shared/database/pool';

const router = Router();
router.use(requireAuth);

/** Orders available for BoxUI — read-only, never creates orders. */
router.get('/orders', requireAnyPermission('boxapp.orders.read', 'orders.read'), async (_req, res, next) => {
  try {
    const rows = await listActiveOrdersForBoxing();
    res.json(rows);
  } catch (e) { next(e); }
});

router.get('/orders/by-code/:code', requireAnyPermission('boxapp.orders.read', 'orders.read'), async (req, res, next) => {
  try {
    const progress = await getOrderByCode(req.params.code);
    res.json(progress);
  } catch (e) { next(e); }
});

router.get('/orders/:id/progress', requireAnyPermission('boxapp.orders.read', 'orders.read'), async (req, res, next) => {
  try {
    const progress = await getOrderProgress(req.params.id);
    res.json(progress);
  } catch (e) { next(e); }
});

/** Pack scan — barcode/size validation, overproduction prevention. */
router.post('/scan',
  requireAnyPermission('box.scan', 'box.create'),
  rateLimit(120, 60_000),
  idempotencyGuard(),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const workerRes = await pool.query(
        `SELECT id FROM workers WHERE user_id = $1 AND deleted_at IS NULL`,
        [req.user!.id]
      );
      const result = await recordPackScan({
        order_code: req.body?.order_code,
        size_code: req.body?.size_code,
        quantity: Number(req.body?.quantity) || 1,
        box_uid: req.body?.box_uid,
        barcode: req.body?.barcode,
        worker_id: req.body?.worker_id || workerRes.rows[0]?.id,
        user_id: req.user!.id,
        device_id: req.body?.device_id,
        ip_address: clientIp(req),
        idempotency_key: req.headers['x-idempotency-key'] as string,
      });
      res.json(result);
    } catch (e) { next(e); }
  }
);

/** Create box for order (BoxUI packing station). */
router.post('/boxes',
  requirePermission('box.create'),
  rateLimit(60, 60_000),
  idempotencyGuard(),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const box = await createBoxForOrder({
        order_code: req.body?.order_code,
        box_num: req.body?.box_num,
        uid: req.body?.uid,
        type: req.body?.type,
        kg: req.body?.kg,
        model: req.body?.model,
        color: req.body?.color,
        sizes: req.body?.sizes,
        items: req.body?.items,
        user_id: req.user!.id,
        user_name: req.user!.full_name,
      });
      res.json(box);
    } catch (e) { next(e); }
  }
);

router.get('/scan-history', requirePermission('box.read'), async (req: AuthRequest, res, next) => {
  try {
    const { order_id, limit = '50' } = req.query;
    const params: (string | number)[] = [];
    let where = '1=1';
    if (order_id) {
      params.push(order_id as string);
      where += ` AND bse.order_id = $${params.length}`;
    }
    params.push(Math.min(Number(limit) || 50, 200));
    const { rows } = await pool.query(`
      SELECT bse.*, o.external_code AS order_code, w.full_name AS worker_name
      FROM box_scan_events bse
      LEFT JOIN orders o ON o.id = bse.order_id
      LEFT JOIN workers w ON w.id = bse.worker_id
      WHERE ${where}
      ORDER BY bse.scanned_at DESC
      LIMIT $${params.length}
    `, params);
    res.json(rows);
  } catch (e) { next(e); }
});

export default router;
