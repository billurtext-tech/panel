import { pool } from '../../shared/database/pool';
import { BadRequest, Conflict, Forbidden, NotFound } from '../../shared/types';
import { isWithinOfficeRadius, distanceMeters, OFFICE_LAT, OFFICE_LON } from '../../shared/utils/geo';
import { compareFaceDescriptors, parseDescriptor } from '../../shared/utils/face';
import path from 'node:path';
import fs from 'node:fs';

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.resolve(process.cwd(), 'uploads');

export interface CheckInOutRequest {
  worker_id: string;
  user_id: string;
  record_type: 'check_in' | 'check_out';
  latitude: number;
  longitude: number;
  face_descriptor?: number[] | string;
  face_snapshot_base64?: string;
  device_info?: string;
  user_agent?: string;
  ip_address?: string;
  idempotency_key?: string;
}

export async function recordAttendance(req: CheckInOutRequest) {
  const { worker_id, record_type, latitude, longitude } = req;

  if (!worker_id) throw BadRequest('worker_id kerak');
  if (record_type !== 'check_in' && record_type !== 'check_out') {
    throw BadRequest("record_type: 'check_in' yoki 'check_out'");
  }
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    throw BadRequest('latitude va longitude kerak');
  }

  const dist = distanceMeters(latitude, longitude, OFFICE_LAT, OFFICE_LON);
  if (!isWithinOfficeRadius(latitude, longitude)) {
    throw Forbidden(
      `Ofis hududidan tashqaridasiz (${Math.round(dist)}m). Maksimum 10m radius.`
    );
  }

  const worker = await pool.query(`
    SELECT id, full_name, face_descriptor, user_id FROM workers
    WHERE id = $1 AND is_active = true AND deleted_at IS NULL
  `, [worker_id]);
  if (!worker.rows.length) throw NotFound('Ishchi topilmadi');

  if (worker.rows[0].user_id && worker.rows[0].user_id !== req.user_id) {
    const adminCheck = await pool.query(
      `SELECT role_id FROM users WHERE id = $1`, [req.user_id]
    );
    const role = adminCheck.rows[0]?.role_id;
    if (role !== 'owner' && role !== 'admin') {
      throw Forbidden('Boshqa ishchi uchun davomat qilish mumkin emas');
    }
  }

  const enrolled = parseDescriptor(worker.rows[0].face_descriptor);
  const captured = parseDescriptor(req.face_descriptor);
  const faceResult = compareFaceDescriptors(enrolled, captured);

  if (!enrolled?.length) {
    throw BadRequest('Yuz ma\'lumotlari ro\'yxatdan o\'tmagan. Administrator bilan bog\'laning.');
  }
  if (!faceResult.match) {
    throw Forbidden('Yuz tasdiqlanmadi. Qayta urinib ko\'ring.');
  }

  // Prevent duplicate check-in without check-out
  const last = await pool.query(`
    SELECT record_type, recorded_at FROM attendance_records
    WHERE worker_id = $1
    ORDER BY recorded_at DESC LIMIT 1
  `, [worker_id]);

  if (last.rows.length) {
    const lastType = last.rows[0].record_type;
    if (record_type === 'check_in' && lastType === 'check_in') {
      throw Conflict('Allaqachon kelgan deb belgilangansiz. Avval ketishni belgilang.');
    }
    if (record_type === 'check_out' && lastType === 'check_out') {
      throw Conflict('Allaqachon ketgan deb belgilangansiz. Avval kelishni belgilang.');
    }
  } else if (record_type === 'check_out') {
    throw Conflict('Avval kelishni belgilang');
  }

  let snapshotPath: string | null = null;
  if (req.face_snapshot_base64) {
    snapshotPath = await saveFaceSnapshot(worker_id, req.face_snapshot_base64);
  }

  const { rows } = await pool.query(`
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

async function saveFaceSnapshot(workerId: string, base64: string): Promise<string> {
  const dir = path.join(UPLOAD_DIR, 'attendance', workerId);
  fs.mkdirSync(dir, { recursive: true });
  const data = base64.replace(/^data:image\/\w+;base64,/, '');
  const filename = `${Date.now()}.jpg`;
  const filepath = path.join(dir, filename);
  fs.writeFileSync(filepath, Buffer.from(data, 'base64'));
  return `/uploads/attendance/${workerId}/${filename}`;
}

export async function enrollFace(workerId: string, descriptor: number[]) {
  if (!descriptor?.length) throw BadRequest('face_descriptor kerak');
  await pool.query(`
    UPDATE workers SET face_descriptor = $1, face_enrolled_at = NOW()
    WHERE id = $2
  `, [JSON.stringify(descriptor), workerId]);
  return { ok: true };
}

export async function getAttendanceStatus(workerId: string) {
  const last = await pool.query(`
    SELECT * FROM attendance_records
    WHERE worker_id = $1
    ORDER BY recorded_at DESC LIMIT 1
  `, [workerId]);

  const today = await pool.query(`
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

export async function getAttendanceHistory(workerId: string, limit = 30) {
  const { rows } = await pool.query(`
    SELECT * FROM attendance_records
    WHERE worker_id = $1
    ORDER BY recorded_at DESC
    LIMIT $2
  `, [workerId, limit]);
  return rows;
}
