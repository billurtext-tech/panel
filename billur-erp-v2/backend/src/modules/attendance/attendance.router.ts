import { Router, Response, NextFunction } from 'express';
import { AuthRequest, BadRequest, Forbidden } from '../../shared/types';
import { requireAuth, requirePermission, requireAnyPermission } from '../../shared/middleware/auth';
import { clientIp, rateLimit } from '../../shared/middleware/security';
import { idempotencyGuard } from '../../shared/middleware/idempotency';
import {
  recordAttendance, enrollFace, getAttendanceStatus, getAttendanceHistory,
} from './attendance.service';
import { pool } from '../../shared/database/pool';
import { getOptionalQueryString, getQueryString } from '../../shared/utils/query';

const router = Router();
router.use(requireAuth);

async function workerIdForUser(userId: string): Promise<string | undefined> {
  const r = await pool.query(
    `SELECT id FROM workers WHERE user_id = $1 AND deleted_at IS NULL`, [userId]
  );
  return r.rows[0]?.id;
}

router.post('/check-in',
  requirePermission('attendance.checkin'),
  rateLimit(20, 60_000),
  idempotencyGuard(),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const wid = req.body?.worker_id || await workerIdForUser(req.user!.id);
      if (!wid) throw BadRequest('Ishchi profili bog\'lanmagan');
      const result = await recordAttendance({
        worker_id: wid,
        user_id: req.user!.id,
        record_type: 'check_in',
        latitude: Number(req.body?.latitude),
        longitude: Number(req.body?.longitude),
        face_descriptor: req.body?.face_descriptor,
        face_snapshot_base64: req.body?.face_snapshot,
        device_info: req.body?.device_info,
        user_agent: req.headers['user-agent'],
        ip_address: clientIp(req),
        idempotency_key: req.headers['x-idempotency-key'] as string,
      });
      res.json(result);
    } catch (e) { next(e); }
  }
);

router.post('/check-out',
  requirePermission('attendance.checkin'),
  rateLimit(20, 60_000),
  idempotencyGuard(),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const wid = req.body?.worker_id || await workerIdForUser(req.user!.id);
      if (!wid) throw BadRequest('Ishchi profili bog\'lanmagan');
      const result = await recordAttendance({
        worker_id: wid,
        user_id: req.user!.id,
        record_type: 'check_out',
        latitude: Number(req.body?.latitude),
        longitude: Number(req.body?.longitude),
        face_descriptor: req.body?.face_descriptor,
        face_snapshot_base64: req.body?.face_snapshot,
        device_info: req.body?.device_info,
        user_agent: req.headers['user-agent'],
        ip_address: clientIp(req),
        idempotency_key: req.headers['x-idempotency-key'] as string,
      });
      res.json(result);
    } catch (e) { next(e); }
  }
);

router.get('/status', requirePermission('attendance.view_own', 'attendance.view_all'), async (req: AuthRequest, res, next) => {
  try {
    const wid = getOptionalQueryString(req.query.worker_id) || await workerIdForUser(req.user!.id);
    if (!wid) return res.json({ is_checked_in: false, last_record: null, today_records: [] });
    if (wid !== await workerIdForUser(req.user!.id) &&
        !req.user!.permissions.includes('attendance.view_all')) {
      throw Forbidden();
    }
    res.json(await getAttendanceStatus(wid));
  } catch (e) { next(e); }
});

router.get('/history', requireAnyPermission('attendance.view_own', 'attendance.view_all'), async (req: AuthRequest, res, next) => {
  try {
    const wid = getOptionalQueryString(req.query.worker_id) || await workerIdForUser(req.user!.id);
    if (!wid) return res.json([]);
    if (wid !== await workerIdForUser(req.user!.id) &&
        !req.user!.permissions.includes('attendance.view_all')) {
      throw Forbidden();
    }
    res.json(await getAttendanceHistory(wid, Number(getQueryString(req.query.limit)) || 30));
  } catch (e) { next(e); }
});

router.post('/enroll-face',
  requirePermission('workers.update'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { worker_id, face_descriptor } = req.body || {};
      if (!worker_id) throw BadRequest('worker_id kerak');
      res.json(await enrollFace(worker_id, face_descriptor));
    } catch (e) { next(e); }
  }
);

// Self-enroll (first time) — worker can enroll own face once
router.post('/enroll-face/self',
  requirePermission('attendance.checkin'),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const wid = await workerIdForUser(req.user!.id);
      if (!wid) throw BadRequest('Ishchi profili bog\'lanmagan');
      const existing = await pool.query(
        `SELECT face_descriptor FROM workers WHERE id = $1`, [wid]
      );
      if (existing.rows[0]?.face_descriptor) {
        throw BadRequest('Yuz allaqachon ro\'yxatdan o\'tgan');
      }
      res.json(await enrollFace(wid, req.body?.face_descriptor));
    } catch (e) { next(e); }
  }
);

export default router;
