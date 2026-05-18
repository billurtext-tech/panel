"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.idempotencyGuard = idempotencyGuard;
const pool_1 = require("../database/pool");
/** Replay cached response when X-Idempotency-Key header is present. */
function idempotencyGuard() {
    return async (req, res, next) => {
        const key = req.headers['x-idempotency-key'];
        if (!key || key.length < 8 || key.length > 128)
            return next();
        try {
            const cached = await pool_1.pool.query(`
        SELECT response_code, response_body FROM api_idempotency
        WHERE key = $1 AND expires_at > NOW()
      `, [key]);
            if (cached.rows.length) {
                const row = cached.rows[0];
                return res.status(row.response_code).json(row.response_body);
            }
            const originalJson = res.json.bind(res);
            res.json = (body) => {
                pool_1.pool.query(`
          INSERT INTO api_idempotency (key, user_id, endpoint, response_code, response_body)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (key) DO NOTHING
        `, [key, req.user?.id || null, req.path, res.statusCode || 200, JSON.stringify(body)])
                    .catch(() => { });
                return originalJson(body);
            };
            next();
        }
        catch {
            next();
        }
    };
}
//# sourceMappingURL=idempotency.js.map