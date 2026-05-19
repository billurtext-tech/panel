import { pool } from '../../shared/database/pool';
import { BadRequest, Conflict } from '../../shared/types';

const WORKER_LINK_ROLES = new Set([
  'worker', 'cutting', 'printing', 'sewing', 'quality', 'ironing', 'packing', 'boxing',
]);

const VALID_POSITIONS = [
  'cutting', 'printing', 'sewing', 'quality', 'ironing', 'packing', 'boxing', 'warehouse', 'other',
];

export function roleNeedsWorkerLink(roleId: string): boolean {
  return WORKER_LINK_ROLES.has(roleId);
}

function defaultPositionForRole(roleId: string): string {
  if (VALID_POSITIONS.includes(roleId)) return roleId;
  if (roleId === 'worker') return 'sewing';
  return 'other';
}

export async function linkWorkerToUser(opts: {
  userId: string;
  fullName: string;
  roleId: string;
  workerId?: string | null;
  employeeCode?: string | null;
  position?: string | null;
  defaultStage?: string | null;
}): Promise<{ worker_id: string } | null> {
  const { userId, fullName, roleId, workerId, employeeCode, position, defaultStage } = opts;

  if (!roleNeedsWorkerLink(roleId) && !workerId) return null;

  if (workerId) {
    const w = await pool.query(
      `SELECT id, user_id FROM workers WHERE id = $1 AND deleted_at IS NULL`,
      [workerId]
    );
    if (!w.rows.length) throw BadRequest('Ishchi topilmadi');
    if (w.rows[0].user_id && w.rows[0].user_id !== userId) {
      throw Conflict('Bu ishchi boshqa foydalanuvchiga biriktirilgan');
    }
    await pool.query(`UPDATE workers SET user_id = $1 WHERE id = $2`, [userId, workerId]);
    return { worker_id: workerId };
  }

  if (!roleNeedsWorkerLink(roleId)) return null;

  const existing = await pool.query(
    `SELECT id FROM workers WHERE user_id = $1 AND deleted_at IS NULL`,
    [userId]
  );
  if (existing.rows.length) return { worker_id: existing.rows[0].id };

  const code = (employeeCode || '').trim();
  if (!code) throw BadRequest('Ishchi roli uchun tabel raqami kerak');

  if (!/^[A-Za-z0-9_-]{2,32}$/.test(code)) {
    throw BadRequest('Tabel raqami: 2-32 belgi, A-Z 0-9 _ -');
  }

  const pos = position && VALID_POSITIONS.includes(position)
    ? position
    : defaultPositionForRole(roleId);

  if (defaultStage) {
    const stg = await pool.query(
      `SELECT 1 FROM production_stages WHERE id = $1 AND is_active`,
      [defaultStage]
    );
    if (!stg.rows.length) throw BadRequest("Noto'g'ri bosqich");
  }

  const dup = await pool.query(
    `SELECT 1 FROM workers WHERE UPPER(employee_code) = UPPER($1) AND deleted_at IS NULL AND user_id IS DISTINCT FROM $2`,
    [code, userId]
  );
  if (dup.rows.length) throw Conflict('Bu tabel raqami band');

  const ins = await pool.query(`
    INSERT INTO workers (employee_code, full_name, position, default_stage, user_id, is_active)
    VALUES ($1, $2, $3, $4, $5, true)
    RETURNING id
  `, [code, fullName, pos, defaultStage || null, userId]);

  return { worker_id: ins.rows[0].id };
}
