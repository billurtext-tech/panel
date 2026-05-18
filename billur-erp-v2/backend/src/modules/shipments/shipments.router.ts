import { Router, Response, NextFunction } from 'express';
import { pool, withTransaction } from '../../shared/database/pool';
import { AuthRequest, SqlParams, BadRequest, NotFound, Conflict } from '../../shared/types';
import { requireAuth, requirePermission } from '../../shared/middleware/auth';
import { auditLog, clientIp } from '../../shared/middleware/security';
import { getOptionalQueryString } from '../../shared/utils/query';
import { syncShipmentCreate, syncShipmentUpdate } from '../boxapp/boxapp.service';
import type { ShipmentSyncRecord } from '../boxapp/boxapp.types';

const router = Router();
router.use(requireAuth);

router.get('/', requirePermission('box.read'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const status = getOptionalQueryString(req.query.status);
    const client_id = getOptionalQueryString(req.query.client_id);
    const params: SqlParams = [];
    const conds: string[] = [];
    if (status)    { params.push(status);    conds.push(`s.status = $${params.length}`); }
    if (client_id) { params.push(client_id); conds.push(`s.client_id = $${params.length}`); }

    const whereSql = conds.length ? `WHERE ${conds.join(' AND ')}` : '';

    const { rows } = await pool.query(`
      SELECT s.*, c.name AS client_name, c.code AS client_code,
             COALESCE(jsonb_array_length(s.box_uids), 0) AS box_count
      FROM shipments s
      LEFT JOIN clients c ON c.id = s.client_id
      ${whereSql}
      ORDER BY s.created_at DESC
      LIMIT 200
    `, params);
    res.json(rows);
  } catch (e) { next(e); }
});

/** BoxUIApp-compatible open shipment workflow (incremental box add/remove). */
router.get('/open', requirePermission('box.read'), async (_req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM shipments WHERE status = 'open' ORDER BY created_at DESC LIMIT 1`
    );
    res.json(rows[0] || null);
  } catch (e) { next(e); }
});

router.post('/open', requirePermission('box.update'), async (req: AuthRequest, res, next) => {
  try {
    const exist = await pool.query(`SELECT id FROM shipments WHERE status = 'open' LIMIT 1`);
    if (exist.rows.length) throw Conflict(`Ochiq shipment bor: ${exist.rows[0].id}`);

    const cnt = await pool.query(`SELECT COUNT(*)::int AS c FROM shipments`);
    const id = `SHP-${String(cnt.rows[0].c + 1).padStart(3, '0')}`;
    const { truckInfo, note, truck_info } = req.body || {};
    const truck = truckInfo || truck_info || null;

    const { rows } = await pool.query(`
      INSERT INTO shipments (id, truck_info, note, status, box_uids, created_by, created_by_name)
      VALUES ($1, $2, $3, 'open', '[]'::jsonb, $4, $5)
      RETURNING *
    `, [id, truck, note || null, req.user!.id, req.user!.full_name]);

    await auditLog({
      event_type: 'shipment.open',
      user_id: req.user!.id, username: req.user!.username,
      resource_type: 'shipment', resource_id: id, action: 'open',
      ip_address: clientIp(req),
    });
    res.json(rows[0]);
  } catch (e) { next(e); }
});

router.post('/open/boxes', requirePermission('box.update'), async (req: AuthRequest, res, next) => {
  try {
    const boxUid = String(req.body?.boxUid || req.body?.box_uid || '').trim();
    const action = String(req.body?.action || '').trim();
    if (!boxUid || !['add', 'remove'].includes(action)) {
      throw BadRequest('boxUid va action (add|remove) kerak');
    }

    const result = await withTransaction(async (client) => {
      const shp = await client.query(
        `SELECT * FROM shipments WHERE status = 'open' LIMIT 1 FOR UPDATE`
      );
      if (!shp.rows.length) throw NotFound('Ochiq shipment topilmadi');
      const shipment = shp.rows[0];

      const boxRes = await client.query(`SELECT * FROM boxes WHERE uid = $1 FOR UPDATE`, [boxUid]);
      if (!boxRes.rows.length) throw NotFound('Box topilmadi');
      const box = boxRes.rows[0];

      let boxUids: string[] = Array.isArray(shipment.box_uids) ? [...shipment.box_uids] : [];
      let history = Array.isArray(box.status_history) ? [...box.status_history] : [];

      if (action === 'add') {
        if (box.status !== 'warehouse') throw BadRequest("Faqat ombordagi box qo'shiladi");
        if (!boxUids.includes(box.uid)) boxUids.push(box.uid);
        history.push({ from: 'warehouse', to: 'shipping', at: new Date().toISOString(), by: req.user!.username });
        await client.query(
          `UPDATE boxes SET status = 'shipping', status_history = $1, updated_at = NOW() WHERE uid = $2`,
          [JSON.stringify(history), box.uid]
        );
      } else {
        if (box.status !== 'shipping') throw BadRequest('Faqat shipmentdagi box olib tashlanadi');
        boxUids = boxUids.filter((u: string) => u !== box.uid);
        history.push({ from: 'shipping', to: 'warehouse', at: new Date().toISOString(), by: req.user!.username });
        await client.query(
          `UPDATE boxes SET status = 'warehouse', status_history = $1, updated_at = NOW() WHERE uid = $2`,
          [JSON.stringify(history), box.uid]
        );
      }

      const snap = boxUids.length
        ? (await client.query(
            `SELECT uid, zakaz, box_num, model, color, sizes, items, kg FROM boxes WHERE uid = ANY($1::text[])`,
            [boxUids]
          )).rows
        : [];

      await client.query(`
        UPDATE shipments SET box_uids = $1, snapshot = $2, updated_at = NOW() WHERE id = $3
      `, [JSON.stringify(boxUids), JSON.stringify(snap), shipment.id]);

      const updated = await client.query(`SELECT * FROM shipments WHERE id = $1`, [shipment.id]);
      return updated.rows[0];
    });

    res.json(result);
  } catch (e) { next(e); }
});

router.post('/open/close', requirePermission('box.update'), async (req: AuthRequest, res, next) => {
  try {
    const open = await pool.query(`SELECT id FROM shipments WHERE status = 'open' LIMIT 1`);
    if (!open.rows.length) throw NotFound('Ochiq shipment yo\'q');
    req.params = { id: open.rows[0].id };
    // Delegate to close handler below via inline logic
    const result = await withTransaction(async (client) => {
      const sel = await client.query(
        `SELECT * FROM shipments WHERE id = $1 FOR UPDATE`, [open.rows[0].id]
      );
      if (!sel.rows.length) throw NotFound();
      const uids = sel.rows[0].box_uids || [];
      await client.query(`
        UPDATE shipments SET status = 'closed', closed_at = NOW(), closed_by = $1 WHERE id = $2
      `, [req.user!.id, open.rows[0].id]);
      if (Array.isArray(uids) && uids.length > 0) {
        await client.query(
          `UPDATE boxes SET status = 'shipped', updated_at = NOW() WHERE uid = ANY($1::text[])`,
          [uids]
        );
      }
      return sel.rows[0];
    });

    syncShipmentUpdate({ id: open.rows[0].id, status: 'closed' }, req.user!.id).catch(console.error);
    await auditLog({
      event_type: 'shipment.close',
      user_id: req.user!.id, username: req.user!.username,
      resource_type: 'shipment', resource_id: open.rows[0].id, action: 'close',
      ip_address: clientIp(req),
    });
    res.json(result);
  } catch (e) { next(e); }
});

router.post('/', requirePermission('box.update'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id, client_id, truck_info, note, box_uids } = req.body || {};
    if (!id) throw BadRequest('id kerak');
    if (!Array.isArray(box_uids) || box_uids.length === 0) {
      throw BadRequest('box_uids massivi kerak (kamida 1 ta)');
    }

    const result = await withTransaction(async (client) => {
      const dup = await client.query(`SELECT 1 FROM shipments WHERE id = $1`, [id]);
      if (dup.rows.length) throw Conflict('Bu id band');

      const boxes = await client.query(`
        SELECT uid, status, model, color, sizes, items, kg, zakaz, box_num
        FROM boxes
        WHERE uid = ANY($1::text[])
        FOR UPDATE
      `, [box_uids]);

      if (boxes.rows.length !== box_uids.length) {
        throw BadRequest("Ba'zi box uid topilmadi");
      }
      const bad = boxes.rows.find(b => b.status === 'shipped');
      if (bad) throw Conflict(`Box ${bad.uid} allaqachon shipped`);

      const snapshot = boxes.rows.map(b => ({
        uid: b.uid, zakaz: b.zakaz, box_num: b.box_num,
        model: b.model, color: b.color, sizes: b.sizes, items: b.items,
        kg: Number(b.kg) || 0
      }));

      const ins = await client.query(`
        INSERT INTO shipments
          (id, truck_info, note, status, box_uids, snapshot,
           client_id, created_by, created_by_name)
        VALUES ($1, $2, $3, 'open', $4, $5, $6, $7, $8)
        RETURNING *
      `, [
        id, truck_info || null, note || null,
        JSON.stringify(box_uids),
        JSON.stringify(snapshot),
        client_id || null,
        req.user!.id, req.user!.full_name
      ]);

      await client.query(`
        UPDATE boxes SET status = 'shipping', updated_at = NOW()
        WHERE uid = ANY($1::text[])
      `, [box_uids]);

      return ins.rows[0];
    });

    await auditLog({
      event_type: 'shipment.create',
      user_id: req.user!.id, username: req.user!.username,
      resource_type: 'shipment', resource_id: id, action: 'create',
      metadata: { box_count: box_uids.length, client_id: client_id ?? null },
      ip_address: clientIp(req)
    });

    syncShipmentCreate(result as ShipmentSyncRecord, req.user!.id).catch((err: unknown) =>
      console.error('[boxapp sync enqueue]', err));

    res.json(result);
  } catch (e) { next(e); }
});

router.get('/:id', requirePermission('box.read'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { rows } = await pool.query(`
      SELECT s.*, c.name AS client_name, c.code AS client_code
      FROM shipments s
      LEFT JOIN clients c ON c.id = s.client_id
      WHERE s.id = $1
    `, [req.params.id]);
    if (!rows.length) throw NotFound();

    const uids = rows[0].box_uids || [];
    let boxes: Record<string, unknown>[] = [];
    if (Array.isArray(uids) && uids.length > 0) {
      const b = await pool.query(`SELECT * FROM boxes WHERE uid = ANY($1::text[])`, [uids]);
      boxes = b.rows;
    }
    res.json({ ...rows[0], boxes });
  } catch (e) { next(e); }
});

router.post('/:id/close', requirePermission('box.update'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const result = await withTransaction(async (client) => {
      const sel = await client.query(
        `SELECT * FROM shipments WHERE id = $1 FOR UPDATE`, [req.params.id]
      );
      if (!sel.rows.length) throw NotFound();
      if (sel.rows[0].status === 'closed') throw Conflict('Shipment allaqachon yopilgan');

      const uids = sel.rows[0].box_uids || [];

      await client.query(`
        UPDATE shipments
        SET status = 'closed', closed_at = NOW(), closed_by = $1
        WHERE id = $2
      `, [req.user!.id, req.params.id]);

      if (Array.isArray(uids) && uids.length > 0) {
        await client.query(`
          UPDATE boxes SET status = 'shipped', updated_at = NOW()
          WHERE uid = ANY($1::text[])
        `, [uids]);
      }
      return { box_count: uids.length };
    });

    await auditLog({
      event_type: 'shipment.close',
      user_id: req.user!.id, username: req.user!.username,
      resource_type: 'shipment', resource_id: req.params.id, action: 'close',
      metadata: result,
      ip_address: clientIp(req)
    });

    syncShipmentUpdate({ id: req.params.id, status: 'closed' }, req.user!.id).catch((err: unknown) =>
      console.error('[boxapp sync enqueue]', err));

    res.json({ ok: true, ...result });
  } catch (e) { next(e); }
});

export default router;
