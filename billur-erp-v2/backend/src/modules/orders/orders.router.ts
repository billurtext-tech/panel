import { Router, Response, NextFunction } from 'express';
import { pool, withTransaction } from '../../shared/database/pool';
import { AuthRequest, SqlParams, BadRequest, NotFound } from '../../shared/types';
import { requireAuth, requirePermission } from '../../shared/middleware/auth';
import { auditLog, clientIp } from '../../shared/middleware/security';
import { getOptionalQueryString } from '../../shared/utils/query';
import { parseSetCodes, parseSpekaOrder } from './orders.parsers';

interface SetOrderItem {
  model_id: string;
  color_id: string;
  size_id: string;
  quantity: number;
  set_numbers: string[];
  model_code?: string;
  color_code?: string;
  size_code?: string;
}

interface SpekaBlock {
  model_code: string;
  color_code: string | null;
  sizes: Record<string, number>;
  raw_line?: string;
}

const router = Router();
router.use(requireAuth);

router.get('/', requirePermission('orders.read'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const client_id = getOptionalQueryString(req.query.client_id);
    const status = getOptionalQueryString(req.query.status);
    const type = getOptionalQueryString(req.query.type);
    const params: SqlParams = [];
    const conds: string[] = [`o.deleted_at IS NULL`];
    if (client_id) { params.push(client_id); conds.push(`o.client_id = $${params.length}`); }
    if (status)    { params.push(status);    conds.push(`o.status = $${params.length}`); }
    if (type)      { params.push(type);      conds.push(`o.order_type = $${params.length}`); }

    const { rows } = await pool.query(`
      SELECT o.*, c.name AS client_name, c.code AS client_code,
        (SELECT COUNT(*)::int FROM order_items oi WHERE oi.order_id = o.id) AS items_count
      FROM orders o
      LEFT JOIN clients c ON c.id = o.client_id
      WHERE ${conds.join(' AND ')}
      ORDER BY o.created_at DESC
      LIMIT 200
    `, params);
    res.json(rows);
  } catch (e) { next(e); }
});

router.post('/', requirePermission('orders.create'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { order_type, external_code, client_id, deadline, notes, priority, items } = req.body || {};
    if (!order_type || !['speka','set','standard'].includes(order_type)) {
      throw BadRequest('order_type: speka/set/standard');
    }
    if (!client_id) throw BadRequest('Klient tanlang');

    await pool.query('BEGIN');
    const ord = await pool.query(`
      INSERT INTO orders (order_type, external_code, client_id, deadline, notes, priority,
                          status, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,'active',$7)
      RETURNING *
    `, [order_type, external_code || null, client_id, deadline || null,
        notes || null, priority || 0, req.user!.id]);

    let totalPieces = 0;
    if (Array.isArray(items)) {
      for (const it of items) {
        if (!it.model_id || !it.color_id || !it.size_id || !it.ordered_qty) continue;
        await pool.query(`
          INSERT INTO order_items (order_id, model_id, color_id, size_id, ordered_qty, unit_price_uzs)
          VALUES ($1,$2,$3,$4,$5,$6)
          ON CONFLICT (order_id, model_id, color_id, size_id) DO NOTHING
        `, [ord.rows[0].id, it.model_id, it.color_id, it.size_id, it.ordered_qty, it.unit_price_uzs || null]);
        totalPieces += it.ordered_qty;
      }
      await pool.query(`UPDATE orders SET total_pieces = $1 WHERE id = $2`,
        [totalPieces, ord.rows[0].id]);
    }
    await pool.query('COMMIT');

    await auditLog({
      event_type: 'order.create',
      user_id: req.user!.id, username: req.user!.username,
      resource_type: 'order', resource_id: ord.rows[0].id,
      after_value: ord.rows[0], ip_address: clientIp(req)
    });
    res.json(ord.rows[0]);
  } catch (e) {
    await pool.query('ROLLBACK').catch(() => {});
    next(e);
  }
});

router.get('/:id', requirePermission('orders.read'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { rows } = await pool.query(`
      SELECT o.*, c.name AS client_name, c.code AS client_code
      FROM orders o
      LEFT JOIN clients c ON c.id = o.client_id
      WHERE o.id = $1 AND o.deleted_at IS NULL
    `, [req.params.id]);
    if (!rows.length) throw NotFound();
    const items = await pool.query(`
      SELECT oi.*, m.code AS model_code, m.name AS model_name,
             cl.code AS color_code, cl.name_uz AS color_name,
             s.code AS size_code
      FROM order_items oi
      LEFT JOIN models m ON m.id = oi.model_id
      LEFT JOIN colors cl ON cl.id = oi.color_id
      LEFT JOIN sizes s ON s.id = oi.size_id
      WHERE oi.order_id = $1
      ORDER BY m.code, cl.name_uz, s.sort_order
    `, [req.params.id]);
    res.json({ ...rows[0], items: items.rows });
  } catch (e) { next(e); }
});

router.put('/:id', requirePermission('orders.update'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { external_code, deadline, notes, priority, status } = req.body || {};
    const r = await pool.query(`
      UPDATE orders SET
        external_code = COALESCE($1, external_code),
        deadline = COALESCE($2, deadline),
        notes = COALESCE($3, notes),
        priority = COALESCE($4, priority),
        status = COALESCE($5, status),
        updated_at = NOW()
      WHERE id = $6 AND deleted_at IS NULL
    `, [external_code, deadline, notes, priority, status, req.params.id]);
    if (!r.rowCount) throw NotFound();
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.delete('/:id', requirePermission('orders.delete'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await pool.query(`UPDATE orders SET deleted_at = NOW() WHERE id = $1`, [req.params.id]);
    await auditLog({
      event_type: 'order.delete',
      user_id: req.user!.id, username: req.user!.username,
      resource_type: 'order', resource_id: req.params.id,
      ip_address: clientIp(req)
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/:id/cancel', requirePermission('orders.cancel'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await pool.query(`UPDATE orders SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
      [req.params.id]);
    await auditLog({
      event_type: 'order.cancel',
      user_id: req.user!.id, username: req.user!.username,
      resource_type: 'order', resource_id: req.params.id,
      ip_address: clientIp(req)
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// SET parser
router.post('/set/parse', requirePermission('orders.read'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { codes } = req.body || {};
    if (!Array.isArray(codes)) throw BadRequest('codes massivi kerak');
    const RX = /^SET(\d+)-([A-Z0-9]+)-([A-Z0-9]+)-([A-Z0-9]+)$/i;
    const parsed = codes.map((c: string) => {
      const t = String(c || '').trim().toUpperCase();
      const m = t.match(RX);
      if (!m) return { raw: c, ok: false, error: 'Format noto\'g\'ri' };
      return { raw: c, ok: true, set_number: m[1], model_code: m[2], color_code: m[3], size_code: m[4] };
    });
    res.json({
      total: codes.length,
      valid: parsed.filter(p => p.ok).length,
      invalid: parsed.filter(p => !p.ok).length,
      items: parsed
    });
  } catch (e) { next(e); }
});

// SET → create order from parsed codes
router.post('/set/create-order', requirePermission('orders.create'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { client_id, codes, deadline, notes } = req.body || {};
    if (!client_id) throw BadRequest('client_id kerak');
    if (!Array.isArray(codes) || !codes.length) throw BadRequest('codes massivi kerak');

    const RX = /^SET(\d+)-([A-Z0-9]+)-([A-Z0-9]+)-([A-Z0-9]+)$/i;

    return await withTransaction(async (client) => {
      // Aggregate same (model, color, size) — count occurrences = quantity
      const counts = new Map<string, { model_code: string; color_code: string; size_code: string; qty: number; set_numbers: string[] }>();
      const invalid: string[] = [];

      for (const raw of codes) {
        const t = String(raw || '').trim().toUpperCase();
        const m = t.match(RX);
        if (!m) { invalid.push(raw); continue; }
        const [, setNum, model_code, color_code, size_code] = m;
        const key = `${model_code}|${color_code}|${size_code}`;
        if (!counts.has(key)) {
          counts.set(key, { model_code, color_code, size_code, qty: 0, set_numbers: [] });
        }
        const g = counts.get(key)!;
        g.qty++;
        g.set_numbers.push(setNum);
      }

      if (!counts.size) throw BadRequest('Hech qaysi SET kod to\'g\'ri formatda emas');

      // Resolve model/color/size IDs
      const items: SetOrderItem[] = [];
      for (const [, g] of counts) {
        const model = await client.query(`SELECT id FROM models WHERE code = $1`, [g.model_code]);
        const color = await client.query(`SELECT id FROM colors WHERE code = $1 OR name_uz = $1`, [g.color_code]);
        const size  = await client.query(`SELECT id FROM sizes WHERE code = $1`, [g.size_code]);

        if (!model.rows.length || !color.rows.length || !size.rows.length) {
          throw BadRequest(`${g.model_code}/${g.color_code}/${g.size_code}: model yoki rang yoki size topilmadi (master-data ga qo'shing)`);
        }
        items.push({
          model_id: model.rows[0].id,
          color_id: color.rows[0].id,
          size_id: size.rows[0].id,
          quantity: g.qty,
          set_numbers: g.set_numbers,
          model_code: g.model_code,
          color_code: g.color_code,
          size_code: g.size_code,
        });
      }

      // Create order
      const ord = await client.query(`
        INSERT INTO orders (client_id, order_type, status, deadline, notes, created_by, external_code)
        VALUES ($1, 'set', 'draft', $2::date, $3, $4,
                'SET-' || to_char(NOW(), 'YYMMDD') || '-' || floor(random() * 10000)::text)
        RETURNING *
      `, [client_id, deadline || null, notes || null, req.user!.id]);
      const orderId = ord.rows[0].id;

      // Insert items + set_codes
      for (const it of items) {
        const oi = await client.query(`
          INSERT INTO order_items (order_id, model_id, color_id, size_id, ordered_qty)
          VALUES ($1, $2, $3, $4, $5) RETURNING id
        `, [orderId, it.model_id, it.color_id, it.size_id, it.quantity]);

        for (const setNum of it.set_numbers) {
          await client.query(`
            INSERT INTO set_codes (order_item_id, set_number, model_code, color_code, size_code, raw_code)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT DO NOTHING
          `, [oi.rows[0].id, setNum, it.model_code || '', it.color_code || '', it.size_code || '',
              `SET${setNum}-${it.model_code || ''}-${it.color_code || ''}-${it.size_code || ''}`]);
        }
      }

      return res.json({
        order: ord.rows[0],
        items_created: items.length,
        codes_processed: codes.length,
        invalid_count: invalid.length,
        invalid_samples: invalid.slice(0, 10),
      });
    });
  } catch (e) { next(e); }
});

// Speka parser — multi-line text input → array of {model, color, sizes:{XS:5, S:10, ...}}
router.post('/speka/parse', requirePermission('orders.read'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { text } = req.body || {};
    if (!text || typeof text !== 'string') throw BadRequest('text kerak');

    // Each block: first line has model+color, following lines have size:qty
    // Examples:
    //   LRTT-275 BLUE
    //     M: 10
    //     L: 15
    //     XL: 8
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const blocks: SpekaBlock[] = [];
    let current: SpekaBlock | null = null;

    for (const line of lines) {
      const sizeMatch = line.match(/^([XSML0-9]+)\s*[:=]\s*(\d+)$/i);
      if (sizeMatch && current) {
        current.sizes[sizeMatch[1].toUpperCase()] = parseInt(sizeMatch[2], 10);
        continue;
      }
      // Otherwise this is a new model line
      const parts = line.split(/\s+/);
      if (current) blocks.push(current);
      current = {
        model_code: parts[0],
        color_code: parts.slice(1).join(' ') || null,
        sizes: {} as Record<string, number>,
        raw_line: line,
      };
    }
    if (current) blocks.push(current);

    const items = blocks.filter(b => Object.keys(b.sizes).length > 0);
    const total_qty = items.reduce((s, b) =>
      s + Object.values<number>(b.sizes).reduce((a, q) => a + q, 0), 0);

    res.json({ blocks_count: blocks.length, items, total_qty });
  } catch (e) { next(e); }
});

// Speka → create order from parsed blocks
router.post('/speka/create-order', requirePermission('orders.create'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { client_id, items, deadline, notes } = req.body || {};
    if (!client_id) throw BadRequest('client_id kerak');
    if (!Array.isArray(items) || !items.length) throw BadRequest('items kerak');

    return await withTransaction(async (client) => {
      const ord = await client.query(`
        INSERT INTO orders (client_id, order_type, status, deadline, notes, created_by, external_code)
        VALUES ($1, 'speka', 'draft', $2::date, $3, $4,
                'SPK-' || to_char(NOW(), 'YYMMDD') || '-' || floor(random() * 10000)::text)
        RETURNING *
      `, [client_id, deadline || null, notes || null, req.user!.id]);
      const orderId = ord.rows[0].id;

      let itemsCreated = 0;
      let totalPieces = 0;
      for (const item of items) {
        const modelCode = String(item.model_code || '').trim();
        const model = await client.query(
          `SELECT id FROM models WHERE UPPER(code) = UPPER($1) AND deleted_at IS NULL`,
          [modelCode]
        );
        const colorCode = item.color_code ? String(item.color_code).trim() : null;
        const color = colorCode
          ? await client.query(
              `SELECT id FROM colors WHERE UPPER(code) = UPPER($1) OR UPPER(name_uz) = UPPER($1)`,
              [colorCode]
            )
          : { rows: [{ id: null }] };

        if (!model.rows.length) {
          throw BadRequest(`Model "${modelCode}" topilmadi — avval modellar ro'yxatiga qo'shing`);
        }
        if (colorCode && !color.rows.length) {
          throw BadRequest(`Rang "${colorCode}" topilmadi — avval rang qo'shing`);
        }

        let linePieces = 0;
        for (const [sizeCode, qty] of Object.entries<number>(item.sizes || {})) {
          if (!qty || qty <= 0) continue;
          const size = await client.query(
            `SELECT id FROM sizes WHERE UPPER(code) = UPPER($1)`,
            [String(sizeCode).trim()]
          );
          if (!size.rows.length) {
            throw BadRequest(`O'lcham "${sizeCode}" topilmadi`);
          }
          await client.query(`
            INSERT INTO order_items (order_id, model_id, color_id, size_id, ordered_qty)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (order_id, model_id, color_id, size_id)
            DO UPDATE SET ordered_qty = order_items.ordered_qty + EXCLUDED.ordered_qty
          `, [orderId, model.rows[0].id, color.rows[0]?.id || null, size.rows[0].id, qty]);
          itemsCreated++;
          linePieces += qty;
        }
        totalPieces += linePieces;
      }

      await client.query(`UPDATE orders SET total_pieces = $1 WHERE id = $2`, [totalPieces, orderId]);

      return res.json({ order: ord.rows[0], items_created: itemsCreated, total_pieces: totalPieces });
    });
  } catch (e) { next(e); }
});

// ── SET code parser (single or bulk) ─────────────────────────────────────
router.post('/parse-set', requirePermission('orders.create'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { codes } = req.body || {};
    if (!Array.isArray(codes) || !codes.length) {
      throw BadRequest('codes: string[] kerak');
    }
    const parsed = await parseSetCodes(codes);
    res.json({ parsed });
  } catch (e) { next(e); }
});

// ── Create Speka order from multi-model items + size breakdown ───────────
router.post('/speka', requirePermission('orders.create'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { client_id, deadline, priority, speka_number, items, notes } = req.body || {};
    if (!client_id) throw BadRequest('client_id kerak');

    const parsed = await parseSpekaOrder({ speka_number, items });

    await pool.query('BEGIN');
    try {
      // Create the order
      const ord = await pool.query(`
        INSERT INTO orders (external_code, client_id, order_type, deadline, priority, notes, status, created_by)
        VALUES ($1, $2, 'speka', $3, $4, $5, 'draft', $6)
        RETURNING *
      `, [parsed.external_code, client_id, deadline || null, priority || 0, notes || null, req.user!.id]);

      let totalPieces = 0;
      for (const it of parsed.items_to_create) {
        await pool.query(`
          INSERT INTO order_items (order_id, model_id, color_id, size_id, ordered_qty)
          VALUES ($1, $2, $3, $4, $5)
        `, [ord.rows[0].id, it.model_id, it.color_id, it.size_id, it.quantity]);
        totalPieces += it.quantity;
      }
      await pool.query(`UPDATE orders SET total_pieces = $1 WHERE id = $2`,
        [totalPieces, ord.rows[0].id]);

      await pool.query('COMMIT');

      await auditLog({
        event_type: 'order.speka.create',
        user_id: req.user!.id, username: req.user!.username,
        resource_type: 'order', resource_id: ord.rows[0].id, action: 'create',
        metadata: { items: parsed.items_to_create.length, total_pieces: totalPieces },
        ip_address: clientIp(req),
      });

      res.json({ order: ord.rows[0], items_created: parsed.items_to_create.length, total_pieces: totalPieces });
    } catch (e) {
      await pool.query('ROLLBACK').catch(() => {});
      throw e;
    }
  } catch (e) { next(e); }
});

// ── Create order from a batch of SET codes (each SET = 1 item line) ─────
router.post('/from-sets', requirePermission('orders.create'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { client_id, deadline, priority, codes, notes } = req.body || {};
    if (!client_id) throw BadRequest('client_id kerak');
    if (!Array.isArray(codes) || !codes.length) throw BadRequest('codes[] kerak');

    const parsed = await parseSetCodes(codes);
    if (!parsed.length) throw BadRequest("Hech bir SET kod parse qilinmadi");

    // First set's number → external_code
    const externalCode = `SET-${parsed[0].set_number}`;

    await pool.query('BEGIN');
    try {
      const ord = await pool.query(`
        INSERT INTO orders (external_code, client_id, order_type, deadline, priority, notes, status, created_by)
        VALUES ($1, $2, 'set', $3, $4, $5, 'draft', $6)
        RETURNING *
      `, [externalCode, client_id, deadline || null, priority || 0, notes || null, req.user!.id]);

      let totalPieces = 0;
      let skipped: string[] = [];
      for (const p of parsed) {
        const m = await pool.query(`SELECT id FROM models WHERE UPPER(code) = $1`, [p.model_code]);
        const c = await pool.query(`SELECT id FROM colors WHERE UPPER(code) = $1 OR UPPER(name_uz) = $1`, [p.color_code]);
        const s = await pool.query(`SELECT id FROM sizes WHERE UPPER(code) = $1`, [p.size_code]);

        if (!m.rows.length || !c.rows.length || !s.rows.length) {
          skipped.push(p.raw);
          continue;
        }

        await pool.query(`
          INSERT INTO order_items (order_id, model_id, color_id, size_id, ordered_qty)
          VALUES ($1, $2, $3, $4, 1)
        `, [ord.rows[0].id, m.rows[0].id, c.rows[0].id, s.rows[0].id]);

        // Track in set_codes
        await pool.query(`
          INSERT INTO set_codes (set_number, model_code, color_code, size_code, raw_code)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT DO NOTHING
        `, [p.set_number, p.model_code, p.color_code, p.size_code, p.raw]);

        totalPieces += 1;
      }

      await pool.query(`UPDATE orders SET total_pieces = $1 WHERE id = $2`,
        [totalPieces, ord.rows[0].id]);

      await pool.query('COMMIT');

      await auditLog({
        event_type: 'order.set.create',
        user_id: req.user!.id, username: req.user!.username,
        resource_type: 'order', resource_id: ord.rows[0].id, action: 'create',
        metadata: { total: parsed.length, created: totalPieces, skipped: skipped.length },
        ip_address: clientIp(req),
      });

      res.json({
        order: ord.rows[0],
        items_created: totalPieces,
        skipped,
      });
    } catch (e) {
      await pool.query('ROLLBACK').catch(() => {});
      throw e;
    }
  } catch (e) { next(e); }
});

export default router;
