"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordAttendance = recordAttendance;
exports.enrollFace = enrollFace;
exports.getAttendanceStatus = getAttendanceStatus;
exports.getAttendanceHistory = getAttendanceHistory;
const pool_1 = require("../../shared/database/pool");
const types_1 = require("../../shared/types");
const geo_1 = require("../../shared/utils/geo");
const face_1 = require("../../shared/utils/face");
const node_path_1 = __importDefault(require("node:path"));
const node_fs_1 = __importDefault(require("node:fs"));
const UPLOAD_DIR = process.env.UPLOAD_DIR || node_path_1.default.resolve(process.cwd(), 'uploads');
async function recordAttendance(req) {
    const { worker_id, record_type, latitude, longitude } = req;
    if (!worker_id)
        throw (0, types_1.BadRequest)('worker_id kerak');
    if (record_type !== 'check_in' && record_type !== 'check_out') {
        throw (0, types_1.BadRequest)("record_type: 'check_in' yoki 'check_out'");
    }
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
        throw (0, types_1.BadRequest)('latitude va longitude kerak');
    }
    const dist = (0, geo_1.distanceMeters)(latitude, longitude, geo_1.OFFICE_LAT, geo_1.OFFICE_LON);
    if (!(0, geo_1.isWithinOfficeRadius)(latitude, longitude)) {
        throw (0, types_1.Forbidden)(`Ofis hududidan tashqaridasiz (${Math.round(dist)}m). Maksimum 10m radius.`);
    }
    const worker = await pool_1.pool.query(`
    SELECT id, full_name, face_descriptor, user_id FROM workers
    WHERE id = $1 AND is_active = true AND deleted_at IS NULL
  `, [worker_id]);
    if (!worker.rows.length)
        throw (0, types_1.NotFound)('Ishchi topilmadi');
    if (worker.rows[0].user_id && worker.rows[0].user_id !== req.user_id) {
        const adminCheck = await pool_1.pool.query(`SELECT role_id FROM users WHERE id = $1`, [req.user_id]);
        const role = adminCheck.rows[0]?.role_id;
        if (role !== 'owner' && role !== 'admin') {
            throw (0, types_1.Forbidden)('Boshqa ishchi uchun davomat qilish mumkin emas');
        }
    }
    const enrolled = (0, face_1.parseDescriptor)(worker.rows[0].face_descriptor);
    const captured = (0, face_1.parseDescriptor)(req.face_descriptor);
    const faceResult = (0, face_1.compareFaceDescriptors)(enrolled, captured);
    if (!enrolled?.length) {
        throw (0, types_1.BadRequest)('Yuz ma\'lumotlari ro\'yxatdan o\'tmagan. Administrator bilan bog\'laning.');
    }
    if (!faceResult.match) {
        throw (0, types_1.Forbidden)('Yuz tasdiqlanmadi. Qayta urinib ko\'ring.');
    }
    // Prevent duplicate check-in without check-out
    const last = await pool_1.pool.query(`
    SELECT record_type, recorded_at FROM attendance_records
    WHERE worker_id = $1
    ORDER BY recorded_at DESC LIMIT 1
  `, [worker_id]);
    if (last.rows.length) {
        const lastType = last.rows[0].record_type;
        if (record_type === 'check_in' && lastType === 'check_in') {
            throw (0, types_1.Conflict)('Allaqachon kelgan deb belgilangansiz. Avval ketishni belgilang.');
        }
        if (record_type === 'check_out' && lastType === 'check_out') {
            throw (0, types_1.Conflict)('Allaqachon ketgan deb belgilangansiz. Avval kelishni belgilang.');
        }
    }
    else if (record_type === 'check_out') {
        throw (0, types_1.Conflict)('Avval kelishni belgilang');
    }
    let snapshotPath = null;
    if (req.face_snapshot_base64) {
        snapshotPath = await saveFaceSnapshot(worker_id, req.face_snapshot_base64);
    }
    const { rows } = await pool_1.pool.query(`
    INSERT INTO attendance_records
      (worker_id, user_id, record_type, latitude, longitude, distance_meters,
       face_verified, face_match_score, face_snapshot_path,
       device_info, user_agent, ip_address, idempotency_key)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
    RETURNING *
  `, [
        worker_id, req.user_id, record_type, latitude, longitude, dist,
        true, faceResult.score, snapshotPath,
        req.device_info || null, req.user_agent || null, req.ip_address || null,
        req.idempotency_key || null,
    ]);
    return {
        ok: true,
        record: rows[0],
        face_match_score: faceResult.score,
        distance_meters: Math.round(dist * 10) / 10,
    };
}
async function saveFaceSnapshot(workerId, base64) {
    const dir = node_path_1.default.join(UPLOAD_DIR, 'attendance', workerId);
    node_fs_1.default.mkdirSync(dir, { recursive: true });
    const data = base64.replace(/^data:image\/\w+;base64,/, '');
    const filename = `${Date.now()}.jpg`;
    const filepath = node_path_1.default.join(dir, filename);
    node_fs_1.default.writeFileSync(filepath, Buffer.from(data, 'base64'));
    return `/uploads/attendance/${workerId}/${filename}`;
}
async function enrollFace(workerId, descriptor) {
    if (!descriptor?.length)
        throw (0, types_1.BadRequest)('face_descriptor kerak');
    await pool_1.pool.query(`
    UPDATE workers SET face_descriptor = $1, face_enrolled_at = NOW()
    WHERE id = $2
  `, [JSON.stringify(descriptor), workerId]);
    return { ok: true };
}
async function getAttendanceStatus(workerId) {
    const last = await pool_1.pool.query(`
    SELECT * FROM attendance_records
    WHERE worker_id = $1
    ORDER BY recorded_at DESC LIMIT 1
  `, [workerId]);
    const today = await pool_1.pool.query(`
    SELECT record_type, recorded_at FROM attendance_records
    WHERE worker_id = $1 AND recorded_at >= CURRENT_DATE
    ORDER BY recorded_at ASC
  `, [workerId]);
    return {
        is_checked_in: last.rows[0]?.record_type === 'check_in',
        last_record: last.rows[0] || null,
        today_records: today.rows,
    };
}
async function getAttendanceHistory(workerId, limit = 30) {
    const { rows } = await pool_1.pool.query(`
    SELECT * FROM attendance_records
    WHERE worker_id = $1
    ORDER BY recorded_at DESC
    LIMIT $2
  `, [workerId, limit]);
    return rows;
}
//# sourceMappingURL=attendance.service.js.map