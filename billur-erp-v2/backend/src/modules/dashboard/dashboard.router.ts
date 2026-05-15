import { Router } from 'express';
import { pool } from '../../shared/database/pool';
import { requireAuth } from '../../shared/middleware/auth';

const router = Router();
router.use(requireAuth);

router.get('/overview', async (req, res, next) => {
  try {
    const today = new Date().toISOString().slice(0, 10);

    const [orders, clients, workers, openDiscrepancies, todayEvents] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'active')::int AS active,
          COUNT(*) FILTER (WHERE status = 'problem')::int AS problem,
          COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
          COUNT(*)::int AS total
        FROM orders WHERE deleted_at IS NULL
      `),
      pool.query(`SELECT COUNT(*)::int AS c FROM clients WHERE deleted_at IS NULL AND is_active`),
      pool.query(`SELECT COUNT(*)::int AS c FROM workers WHERE deleted_at IS NULL AND is_active`),
      pool.query(`SELECT COUNT(*)::int AS c FROM discrepancies WHERE status = 'open'`),
      pool.query(`
        SELECT to_stage AS stage, COALESCE(SUM(qty), 0)::int AS qty
        FROM production_events
        WHERE DATE(occurred_at) = $1
        GROUP BY to_stage
      `, [today])
    ]);

    res.json({
      orders: orders.rows[0],
      clients: clients.rows[0].c,
      workers: workers.rows[0].c,
      open_discrepancies: openDiscrepancies.rows[0].c,
      today_events: todayEvents.rows
    });
  } catch (e) { next(e); }
});

router.get('/orders-by-stage', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        ps.id AS stage_id,
        ps.name_uz AS stage_name,
        ps.sort_order,
        COALESCE(SUM(
          CASE WHEN ps.id = 'cutting' THEN oi.cut_qty
               WHEN ps.id = 'printing' THEN oi.printed_qty
               WHEN ps.id = 'sewing' THEN oi.sewn_qty
               WHEN ps.id = 'quality' THEN oi.qc_passed_qty
               WHEN ps.id = 'ironing' THEN oi.ironed_qty
               WHEN ps.id = 'packing' THEN oi.packed_qty
               WHEN ps.id = 'boxing' THEN oi.boxed_qty
               WHEN ps.id = 'shipped' THEN oi.shipped_qty
          END
        ), 0)::int AS qty
      FROM production_stages ps
      CROSS JOIN order_items oi
      LEFT JOIN orders o ON o.id = oi.order_id
      WHERE ps.is_active AND o.status IN ('active', 'problem') AND o.deleted_at IS NULL
      GROUP BY ps.id, ps.name_uz, ps.sort_order
      ORDER BY ps.sort_order
    `);
    res.json(rows);
  } catch (e) { next(e); }
});

router.get('/recent-events', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT pe.*, w.full_name AS worker_name, m.code AS model_code,
             cl.code AS color_code, s.code AS size_code
      FROM production_events pe
      LEFT JOIN workers w ON w.id = pe.worker_id
      LEFT JOIN order_items oi ON oi.id = pe.order_item_id
      LEFT JOIN models m ON m.id = oi.model_id
      LEFT JOIN colors cl ON cl.id = oi.color_id
      LEFT JOIN sizes s ON s.id = oi.size_id
      ORDER BY pe.occurred_at DESC
      LIMIT 50
    `);
    res.json(rows);
  } catch (e) { next(e); }
});

// 7-day production chart by stage
router.get('/production-chart', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        TO_CHAR(d::date, 'Dy') AS name,
        TO_CHAR(d::date, 'YYYY-MM-DD') AS date,
        COALESCE(SUM(qty) FILTER (WHERE to_stage = 'cutting'), 0)::int AS cutting,
        COALESCE(SUM(qty) FILTER (WHERE to_stage = 'sewing'),  0)::int AS sewing,
        COALESCE(SUM(qty) FILTER (WHERE to_stage = 'packing'), 0)::int AS packing
      FROM generate_series(
        (CURRENT_DATE - INTERVAL '6 days')::date,
        CURRENT_DATE::date,
        '1 day'
      ) d
      LEFT JOIN production_events pe ON DATE(pe.occurred_at) = d::date
      GROUP BY d
      ORDER BY d
    `);
    res.json(rows);
  } catch (e) { next(e); }
});

// 7-day quality chart (defects + rework + rejects)
router.get('/quality-chart', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        TO_CHAR(d::date, 'Dy') AS name,
        TO_CHAR(d::date, 'YYYY-MM-DD') AS date,
        COALESCE(COUNT(*) FILTER (WHERE qd.decision = 'passed'),                              0)::int AS passed,
        COALESCE(COUNT(*) FILTER (WHERE qd.decision IN ('defect','sort_2')),                  0)::int AS defects,
        COALESCE(COUNT(*) FILTER (WHERE qd.decision IN ('rework','reject')),                  0)::int AS rejects
      FROM generate_series(
        (CURRENT_DATE - INTERVAL '6 days')::date,
        CURRENT_DATE::date,
        '1 day'
      ) d
      LEFT JOIN quality_decisions qd ON DATE(qd.created_at) = d::date
      GROUP BY d
      ORDER BY d
    `);
    res.json(rows);
  } catch (e) { next(e); }
});

export default router;
