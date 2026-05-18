"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const types_1 = require("../../shared/types");
const auth_1 = require("../../shared/middleware/auth");
const security_1 = require("../../shared/middleware/security");
const idempotency_1 = require("../../shared/middleware/idempotency");
const attendance_service_1 = require("./attendance.service");
const pool_1 = require("../../shared/database/pool");
const query_1 = require("../../shared/utils/query");
const router = (0, express_1.Router)();
router.use(auth_1.requireAuth);
async function workerIdForUser(userId) {
    const r = await pool_1.pool.query(`SELECT id FROM workers WHERE user_id = $1 AND deleted_at IS NULL`, [userId]);
    return r.rows[0]?.id;
}
router.post('/check-in', (0, auth_1.requirePermission)('attendance.checkin'), (0, security_1.rateLimit)(20, 60_000), (0, idempotency_1.idempotencyGuard)(), async (req, res, next) => {
    try {
        const wid = req.body?.worker_id || await workerIdForUser(req.user.id);
        if (!wid)
            throw (0, types_1.BadRequest)('Ishchi profili bog\'lanmagan');
        const result = await (0, attendance_service_1.recordAttendance)({
            worker_id: wid,
            user_id: req.user.id,
            record_type: 'check_in',
            latitude: Number(req.body?.latitude),
            longitude: Number(req.body?.longitude),
            face_descriptor: req.body?.face_descriptor,
            face_snapshot_base64: req.body?.face_snapshot,
            device_info: req.body?.device_info,
            user_agent: req.headers['user-agent'],
            ip_address: (0, security_1.clientIp)(req),
            idempotency_key: req.headers['x-idempotency-key'],
        });
        res.json(result);
    }
    catch (e) {
        next(e);
    }
});
router.post('/check-out', (0, auth_1.requirePermission)('attendance.checkin'), (0, security_1.rateLimit)(20, 60_000), (0, idempotency_1.idempotencyGuard)(), async (req, res, next) => {
    try {
        const wid = req.body?.worker_id || await workerIdForUser(req.user.id);
        if (!wid)
            throw (0, types_1.BadRequest)('Ishchi profili bog\'lanmagan');
        const result = await (0, attendance_service_1.recordAttendance)({
            worker_id: wid,
            user_id: req.user.id,
            record_type: 'check_out',
            latitude: Number(req.body?.latitude),
            longitude: Number(req.body?.longitude),
            face_descriptor: req.body?.face_descriptor,
            face_snapshot_base64: req.body?.face_snapshot,
            device_info: req.body?.device_info,
            user_agent: req.headers['user-agent'],
            ip_address: (0, security_1.clientIp)(req),
            idempotency_key: req.headers['x-idempotency-key'],
        });
        res.json(result);
    }
    catch (e) {
        next(e);
    }
});
router.get('/status', (0, auth_1.requirePermission)('attendance.view_own', 'attendance.view_all'), async (req, res, next) => {
    try {
        const wid = (0, query_1.getOptionalQueryString)(req.query.worker_id) || await workerIdForUser(req.user.id);
        if (!wid)
            return res.json({ is_checked_in: false, last_record: null, today_records: [] });
        if (wid !== await workerIdForUser(req.user.id) &&
            !req.user.permissions.includes('attendance.view_all')) {
            throw (0, types_1.Forbidden)();
        }
        res.json(await (0, attendance_service_1.getAttendanceStatus)(wid));
    }
    catch (e) {
        next(e);
    }
});
router.get('/history', (0, auth_1.requireAnyPermission)('attendance.view_own', 'attendance.view_all'), async (req, res, next) => {
    try {
        const wid = (0, query_1.getOptionalQueryString)(req.query.worker_id) || await workerIdForUser(req.user.id);
        if (!wid)
            return res.json([]);
        if (wid !== await workerIdForUser(req.user.id) &&
            !req.user.permissions.includes('attendance.view_all')) {
            throw (0, types_1.Forbidden)();
        }
        res.json(await (0, attendance_service_1.getAttendanceHistory)(wid, Number((0, query_1.getQueryString)(req.query.limit)) || 30));
    }
    catch (e) {
        next(e);
    }
});
router.post('/enroll-face', (0, auth_1.requirePermission)('workers.update'), async (req, res, next) => {
    try {
        const { worker_id, face_descriptor } = req.body || {};
        if (!worker_id)
            throw (0, types_1.BadRequest)('worker_id kerak');
        res.json(await (0, attendance_service_1.enrollFace)(worker_id, face_descriptor));
    }
    catch (e) {
        next(e);
    }
});
// Self-enroll (first time) — worker can enroll own face once
router.post('/enroll-face/self', (0, auth_1.requirePermission)('attendance.checkin'), async (req, res, next) => {
    try {
        const wid = await workerIdForUser(req.user.id);
        if (!wid)
            throw (0, types_1.BadRequest)('Ishchi profili bog\'lanmagan');
        const existing = await pool_1.pool.query(`SELECT face_descriptor FROM workers WHERE id = $1`, [wid]);
        if (existing.rows[0]?.face_descriptor) {
            throw (0, types_1.BadRequest)('Yuz allaqachon ro\'yxatdan o\'tgan');
        }
        res.json(await (0, attendance_service_1.enrollFace)(wid, req.body?.face_descriptor));
    }
    catch (e) {
        next(e);
    }
});
exports.default = router;
//# sourceMappingURL=attendance.router.js.map