"use strict";
// Production scanning service.
// Implements the core textile workflow:
//   1. Cutting worker scans → QR code is created OR they START on existing code
//   2. Worker scans QR → either START (acquire lock) or FINISH (release lock + advance stage)
//   3. Only one worker can hold a (qr_code, stage) lock at a time
//   4. Once a worker finishes a (qr_code, stage), they can never rescan it
//   5. Race conditions are prevented with SELECT ... FOR UPDATE
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordScan = recordScan;
exports.overrideScan = overrideScan;
const pool_1 = require("../../shared/database/pool");
const types_1 = require("../../shared/types");
// Stage workflow order — used to advance after FINISH
const STAGE_ORDER = [
    'cutting', 'printing', 'sewing', 'quality',
    'ironing', 'packing', 'boxing', 'finished', 'shipped',
];
function nextStage(current) {
    const idx = STAGE_ORDER.indexOf(current);
    if (idx < 0 || idx === STAGE_ORDER.length - 1)
        return null;
    return STAGE_ORDER[idx + 1];
}
// Minimum reasonable seconds between START and FINISH per stage.
// Used for anti-cheating — anything faster is flagged.
const MIN_SECONDS_BY_STAGE = {
    cutting: 30, printing: 20, sewing: 60, quality: 10,
    ironing: 15, packing: 20, boxing: 10,
};
/** Validates and records a scan in a serializable transaction. */
async function recordScan(req) {
    const { qr_code, worker_id, stage, action } = req;
    if (!qr_code || !worker_id || !stage) {
        throw (0, types_1.BadRequest)('qr_code, worker_id, stage majburiy');
    }
    if (action !== 'START' && action !== 'FINISH') {
        throw (0, types_1.BadRequest)("action 'START' yoki 'FINISH' bo'lishi kerak");
    }
    return (0, pool_1.withTransaction)(async (client) => {
        // Lock the QR row first to serialize concurrent scanners
        const qrRes = await client.query(`SELECT * FROM production_qr_codes WHERE qr_code = $1 FOR UPDATE`, [qr_code]);
        if (!qrRes.rows.length)
            throw (0, types_1.NotFound)('QR code topilmadi');
        const qr = qrRes.rows[0];
        // Ensure the QR is at this stage
        if (qr.current_stage !== stage) {
            throw (0, types_1.Conflict)(`Bu QR hozir '${qr.current_stage}' bosqichida. Siz '${stage}' ga scan qildingiz.`);
        }
        if (qr.status === 'completed' || qr.status === 'rejected') {
            throw (0, types_1.Conflict)(`Bu QR ${qr.status === 'completed' ? 'tugatilgan' : 'rad etilgan'}`);
        }
        // Verify worker exists and is active
        const wRes = await client.query(`SELECT id, full_name, default_stage FROM workers
       WHERE id = $1 AND is_active = true AND deleted_at IS NULL`, [worker_id]);
        if (!wRes.rows.length)
            throw (0, types_1.NotFound)('Ishchi topilmadi yoki nofaol');
        const worker = wRes.rows[0];
        // Check if this worker has already FINISHED this stage on this QR
        const doneRes = await client.query(`SELECT id FROM production_stage_scans
       WHERE qr_code_id = $1 AND stage = $2 AND worker_id = $3
         AND status IN ('finished','override')`, [qr.id, stage, worker_id]);
        if (doneRes.rows.length) {
            throw (0, types_1.Conflict)('Bu operatsiya allaqachon tugatilgan. Qayta scan qilish mumkin emas.');
        }
        if (action === 'START') {
            return await startScan(client, qr, worker, stage, req);
        }
        else {
            return await finishScan(client, qr, worker, stage, req);
        }
    });
}
async function startScan(client, qr, worker, stage, req) {
    // Lock check — is the QR currently locked by ANY worker?
    if (qr.current_worker_id && qr.current_worker_id !== worker.id) {
        // Look up who has it
        const other = await client.query(`SELECT full_name FROM workers WHERE id = $1`, [qr.current_worker_id]);
        const name = other.rows[0]?.full_name || 'boshqa ishchi';
        throw (0, types_1.Conflict)(`Bu QR code hozir boshqa ishchiga (${name}) biriktirilgan`);
    }
    // Suspicious checks
    let suspicious = false;
    let reason;
    if (worker.default_stage && worker.default_stage !== stage) {
        suspicious = true;
        reason = `Ishchi doimiy bosqichi (${worker.default_stage}) ${stage} dan farq qiladi`;
    }
    // Insert the scan record (UNIQUE index uq_pss_active_worker prevents double-START)
    const ins = await client.query(`
    INSERT INTO production_stage_scans
      (qr_code_id, stage, worker_id, start_scan_at, status,
       device_id, ip_address, is_suspicious, suspicious_reason, notes)
    VALUES ($1, $2, $3, NOW(), 'started', $4, $5, $6, $7, $8)
    RETURNING id, start_scan_at
  `, [
        qr.id, stage, worker.id,
        req.device_id || null, req.ip_address || null,
        suspicious, reason || null, req.notes || null,
    ]);
    // Acquire lock + mark QR in_progress
    await client.query(`
    UPDATE production_qr_codes
    SET current_worker_id = $1, status = 'in_progress'
    WHERE id = $2
  `, [worker.id, qr.id]);
    return {
        ok: true,
        qr_code_id: qr.id,
        scan_id: ins.rows[0].id,
        action: 'START',
        status: 'started',
        current_stage: stage,
        next_stage: nextStage(stage),
        is_suspicious: suspicious,
        suspicious_reason: reason,
    };
}
async function finishScan(client, qr, worker, stage, req) {
    // Worker must hold the active START on this (qr, stage)
    const startRes = await client.query(`
    SELECT * FROM production_stage_scans
    WHERE qr_code_id = $1 AND stage = $2 AND worker_id = $3 AND status = 'started'
    ORDER BY start_scan_at DESC LIMIT 1
    FOR UPDATE
  `, [qr.id, stage, worker.id]);
    if (!startRes.rows.length) {
        throw (0, types_1.Conflict)("Siz bu QR'ga START scan qilmagansiz. Avval START scan qiling.");
    }
    const startedScan = startRes.rows[0];
    // Also confirm the QR lock still belongs to this worker
    if (qr.current_worker_id !== worker.id) {
        throw (0, types_1.Conflict)('QR lock siz ostingizda emas (admin override bo\'lgan bo\'lishi mumkin)');
    }
    // Compute duration
    const startedAt = new Date(startedScan.start_scan_at).getTime();
    const finishedAt = Date.now();
    const duration = Math.round((finishedAt - startedAt) / 1000);
    // Anti-cheating: too fast
    const minSec = MIN_SECONDS_BY_STAGE[stage] ?? 10;
    let suspicious = startedScan.is_suspicious;
    let reason = startedScan.suspicious_reason;
    if (duration < minSec) {
        suspicious = true;
        reason = `Juda tez tugatildi: ${duration}s (minimum ${minSec}s kutilgan)`;
    }
    // Update the scan to finished
    await client.query(`
    UPDATE production_stage_scans
    SET status = 'finished',
        finish_scan_at = NOW(),
        duration_seconds = $1,
        is_suspicious = $2,
        suspicious_reason = COALESCE($3, suspicious_reason),
        notes = COALESCE($4, notes)
    WHERE id = $5
  `, [duration, suspicious, reason, req.notes || null, startedScan.id]);
    // Record quality decision (if provided or if it's the quality stage)
    let advance = true;
    let setStatus = 'pending'; // default
    if (stage === 'quality' || req.quality) {
        const q = req.quality;
        if (!q)
            throw (0, types_1.BadRequest)("Quality bosqichida 'quality' ma'lumotlari talab qilinadi");
        await client.query(`
      INSERT INTO quality_decisions
        (scan_id, qr_code_id, decision, defect_type, description, photo_url,
         responsible_worker_id, responsible_stage, quantity_affected, checked_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [
            startedScan.id, qr.id, q.decision,
            q.defect_type || null, q.description || null, q.photo_url || null,
            q.responsible_worker_id || null, q.responsible_stage || null,
            q.quantity_affected || qr.quantity,
            worker.id,
        ]);
        if (q.decision === 'reject') {
            advance = false;
            setStatus = 'rejected';
        }
        else if (q.decision === 'rework') {
            // Send back to sewing
            advance = false;
            setStatus = 'reworking';
            await client.query(`
        UPDATE production_qr_codes
        SET current_stage = 'sewing', current_worker_id = NULL, status = 'reworking'
        WHERE id = $1
      `, [qr.id]);
        }
    }
    if (advance && setStatus === 'pending') {
        const next = nextStage(stage);
        if (next) {
            // Move to next stage, release lock
            await client.query(`
        UPDATE production_qr_codes
        SET current_stage = $1, current_worker_id = NULL, status = 'pending'
        WHERE id = $2
      `, [next, qr.id]);
        }
        else {
            // No next stage — completed
            await client.query(`
        UPDATE production_qr_codes
        SET current_worker_id = NULL, status = 'completed', completed_at = NOW()
        WHERE id = $1
      `, [qr.id]);
        }
    }
    return {
        ok: true,
        qr_code_id: qr.id,
        scan_id: startedScan.id,
        action: 'FINISH',
        status: 'finished',
        current_stage: stage,
        next_stage: advance ? nextStage(stage) : null,
        duration_seconds: duration,
        is_suspicious: suspicious,
        suspicious_reason: reason || undefined,
    };
}
/** Admin override — force-release a stuck QR lock. */
async function overrideScan(opts) {
    return (0, pool_1.withTransaction)(async (client) => {
        const qr = await client.query(`SELECT * FROM production_qr_codes WHERE id = $1 FOR UPDATE`, [opts.qr_code_id]);
        if (!qr.rows.length)
            throw (0, types_1.NotFound)('QR topilmadi');
        if (!qr.rows[0].current_worker_id) {
            throw (0, types_1.BadRequest)('Bu QR ostida ishchi yo\'q (override kerakmas)');
        }
        // Mark any active 'started' scan as override
        await client.query(`
      UPDATE production_stage_scans
      SET status = 'override',
          finish_scan_at = NOW(),
          override_by = $1, override_at = NOW(), override_reason = $2
      WHERE qr_code_id = $3 AND status = 'started'
    `, [opts.override_by, opts.reason, opts.qr_code_id]);
        // Release the lock
        await client.query(`
      UPDATE production_qr_codes SET current_worker_id = NULL, status = 'pending'
      WHERE id = $1
    `, [opts.qr_code_id]);
        return { ok: true };
    });
}
//# sourceMappingURL=scanning.service.js.map