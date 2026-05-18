"use strict";
// BoxApp integration service.
// All box/shipment changes in ERP are queued and sync'd to the external BoxApp
// (https://app.andbillur.com) via REST. If BoxApp is unavailable, the queue
// retains the job and a background worker retries with exponential back-off.
Object.defineProperty(exports, "__esModule", { value: true });
exports.enqueue = enqueue;
exports.processJob = processJob;
exports.processQueue = processQueue;
exports.startBackgroundSync = startBackgroundSync;
exports.syncBoxCreate = syncBoxCreate;
exports.syncShipmentCreate = syncShipmentCreate;
exports.syncShipmentUpdate = syncShipmentUpdate;
exports.syncBoxUpdate = syncBoxUpdate;
exports.syncBoxDelete = syncBoxDelete;
exports.syncOrderToBoxApp = syncOrderToBoxApp;
const pool_1 = require("../../shared/database/pool");
const json_1 = require("../../shared/utils/json");
const BOXAPP_URL = process.env.BOXAPP_API_URL || 'https://app.andbillur.com';
const BOXAPP_KEY = process.env.BOXAPP_API_KEY || '';
const TIMEOUT_MS = 15_000;
async function enqueue(opts) {
    const r = await pool_1.pool.query(`
    INSERT INTO boxapp_sync_jobs
      (entity_type, entity_id, operation, payload, sync_status, created_by)
    VALUES ($1, $2, $3, $4, 'pending', $5)
    RETURNING *
  `, [opts.entity_type, opts.entity_id, opts.operation,
        JSON.stringify(opts.payload), opts.created_by || null]);
    return r.rows[0];
}
function endpointFor(entity, operation, entityId) {
    // Convention — BoxApp REST endpoints:
    //   POST   /api/erp/boxes
    //   PUT    /api/erp/boxes/:uid
    //   DELETE /api/erp/boxes/:uid
    //   POST   /api/erp/shipments
    //   PUT    /api/erp/shipments/:id
    const base = `/api/erp/${entity}s`;
    if (operation === 'create')
        return { method: 'POST', path: base };
    if (operation === 'update')
        return { method: 'PUT', path: `${base}/${entityId}` };
    return { method: 'DELETE', path: `${base}/${entityId}` };
}
/** Try to push a single job. Returns true on success, false on failure. */
async function processJob(jobId) {
    // Lock row to prevent double-processing
    const lock = await pool_1.pool.query(`
    UPDATE boxapp_sync_jobs SET sync_status = 'syncing', attempts = attempts + 1, last_attempt_at = NOW()
    WHERE id = $1 AND sync_status IN ('pending','failed')
    RETURNING *
  `, [jobId]);
    if (!lock.rows.length)
        return false; // already syncing or done
    const job = lock.rows[0];
    if (!BOXAPP_KEY) {
        await fail(job.id, 'BOXAPP_API_KEY not configured');
        return false;
    }
    const { method, path } = endpointFor(job.entity_type, job.operation, job.entity_id);
    const url = `${BOXAPP_URL}${path}`;
    try {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
        const res = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${BOXAPP_KEY}`,
                'X-Source': 'billur-erp',
            },
            body: method === 'DELETE' ? undefined : JSON.stringify(job.payload),
            signal: ctrl.signal,
        });
        clearTimeout(tid);
        const text = await res.text();
        let parsed = null;
        try {
            parsed = JSON.parse(text);
        }
        catch {
            parsed = { raw: text };
        }
        if (!res.ok) {
            await fail(job.id, `HTTP ${res.status}: ${text.slice(0, 500)}`);
            return false;
        }
        await pool_1.pool.query(`
      UPDATE boxapp_sync_jobs
      SET sync_status = 'synced', synced_at = NOW(),
          remote_id = $1, remote_response = $2, last_error = NULL, next_retry_at = NULL
      WHERE id = $3
    `, [parsed?.id || parsed?.uid || null, JSON.stringify(parsed), job.id]);
        return true;
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await fail(job.id, msg);
        return false;
    }
}
async function fail(jobId, msg) {
    // Exponential backoff: 1m, 5m, 15m, 1h, 6h, then give up at 10 attempts
    await pool_1.pool.query(`
    UPDATE boxapp_sync_jobs
    SET sync_status = CASE WHEN attempts >= 10 THEN 'failed' ELSE 'pending' END,
        last_error = $1,
        next_retry_at = CASE
          WHEN attempts >= 10 THEN NULL
          WHEN attempts <= 1  THEN NOW() + INTERVAL '1 minute'
          WHEN attempts <= 3  THEN NOW() + INTERVAL '5 minutes'
          WHEN attempts <= 5  THEN NOW() + INTERVAL '15 minutes'
          WHEN attempts <= 7  THEN NOW() + INTERVAL '1 hour'
          ELSE NOW() + INTERVAL '6 hours'
        END
    WHERE id = $2
  `, [msg, jobId]);
}
/** Process all pending/retryable jobs. */
async function processQueue(limit = 20) {
    const due = await pool_1.pool.query(`
    SELECT id FROM boxapp_sync_jobs
    WHERE sync_status IN ('pending','failed')
      AND (next_retry_at IS NULL OR next_retry_at <= NOW())
      AND attempts < 10
    ORDER BY created_at ASC
    LIMIT $1
  `, [limit]);
    let ok = 0;
    for (const row of due.rows) {
        if (await processJob(row.id))
            ok++;
    }
    return { processed: due.rows.length, succeeded: ok };
}
/** Background runner — call once on app startup. */
function startBackgroundSync(intervalMs = 60_000) {
    setInterval(() => {
        processQueue().catch((err) => console.error('[boxapp sync]', err));
    }, intervalMs);
}
// ── Helpers to enqueue from other modules ────────────────────────────────
async function syncBoxCreate(box, userId) {
    return enqueue({
        entity_type: 'box',
        entity_id: box.uid,
        operation: 'create',
        payload: (0, json_1.toJsonValue)({
            uid: box.uid,
            box_number: box.box_num,
            order_id: box.order_id,
            order_number: box.zakaz,
            type: box.type,
            model: box.model,
            color_code: box.color,
            kg: box.kg,
            status: box.status,
            sizes: box.sizes,
            items: box.items,
            packed_by: box.created_by_name,
            packed_at: box.created_at,
        }),
        created_by: userId,
    });
}
async function syncShipmentCreate(shipment, userId) {
    return enqueue({
        entity_type: 'shipment',
        entity_id: shipment.id,
        operation: 'create',
        payload: (0, json_1.toJsonValue)({
            id: shipment.id,
            client_id: shipment.client_id,
            truck_info: shipment.truck_info,
            box_uids: shipment.box_uids,
            status: shipment.status,
            created_at: shipment.created_at,
        }),
        created_by: userId,
    });
}
async function syncShipmentUpdate(shipment, userId) {
    return enqueue({
        entity_type: 'shipment',
        entity_id: shipment.id,
        operation: 'update',
        payload: (0, json_1.toJsonValue)(shipment),
        created_by: userId,
    });
}
async function syncBoxUpdate(box, userId) {
    return enqueue({
        entity_type: 'box',
        entity_id: box.uid,
        operation: 'update',
        payload: (0, json_1.toJsonValue)({
            uid: box.uid,
            box_number: box.box_num,
            order_id: box.order_id,
            order_number: box.zakaz,
            type: box.type,
            model: box.model,
            color_code: box.color,
            kg: box.kg,
            status: box.status,
            sizes: box.sizes,
            items: box.items,
        }),
        created_by: userId,
    });
}
async function syncBoxDelete(uid, userId) {
    return enqueue({
        entity_type: 'box',
        entity_id: uid,
        operation: 'delete',
        payload: { uid },
        created_by: userId,
    });
}
async function syncOrderToBoxApp(order, userId) {
    return enqueue({
        entity_type: 'order',
        entity_id: order.id,
        operation: 'create',
        payload: (0, json_1.toJsonValue)(order),
        created_by: userId,
    });
}
//# sourceMappingURL=boxapp.service.js.map