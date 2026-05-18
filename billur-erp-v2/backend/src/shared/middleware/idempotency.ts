import { Response, NextFunction } from 'express';
import { pool } from '../database/pool';
import { AuthRequest } from '../types';

/** Replay cached response when X-Idempotency-Key header is present. */
export function idempotencyGuard() {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const key = req.headers['x-idempotency-key'] as string | undefined;
    if (!key || key.length < 8 || key.length > 128) return next();

    try {
      const cached = await pool.query(`
        SELECT response_code, response_body FROM api_idempotency
        WHERE key = $1 AND expires_at > NOW()
      `, [key]);

      if (cached.rows.length) {
        const row = cached.rows[0];
        return res.status(row.response_code).json(row.response_body);
      }

      const originalJson = res.json.bind(res);
      res.json = (body: unknown) => {
        pool.query(`
          INSERT INTO api_idempotency (key, user_id, endpoint, response_code, response_body)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (key) DO NOTHING
        `, [key, req.user?.id || null, req.path, res.statusCode || 200, JSON.stringify(body)])
          .catch(() => {});
        return originalJson(body);
      };
      next();
    } catch {
      next();
    }
  };
}
