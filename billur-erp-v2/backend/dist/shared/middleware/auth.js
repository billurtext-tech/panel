"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authMiddleware = authMiddleware;
exports.requireAuth = requireAuth;
exports.requirePermission = requirePermission;
exports.requireAnyPermission = requireAnyPermission;
exports.requireRole = requireRole;
const pool_1 = require("../database/pool");
const types_1 = require("../types");
const query_1 = require("../utils/query");
const SESSION_TTL_HOURS = 8;
async function authMiddleware(req, res, next) {
    const token = req.headers['x-session-token']
        || req.cookies?.token
        || (0, query_1.getOptionalQueryString)(req.query?.token);
    if (!token || typeof token !== 'string' || !/^[a-f0-9]{32,128}$/i.test(token)) {
        req.user = undefined;
        return next();
    }
    try {
        const { rows } = await pool_1.pool.query(`
      SELECT u.id, u.username, u.full_name, u.role_id, u.is_active
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token = $1
        AND s.expires_at > NOW()
        AND u.deleted_at IS NULL
        AND u.is_active = true
    `, [token]);
        if (!rows.length) {
            req.user = undefined;
            return next();
        }
        const user = rows[0];
        // Load permissions: role + overrides
        const permsRes = await pool_1.pool.query(`
      SELECT permission_id, true AS granted FROM role_permissions WHERE role_id = $1
      UNION
      SELECT permission_id, granted FROM user_permission_overrides WHERE user_id = $2
    `, [user.role_id, user.id]);
        const granted = new Set();
        const revoked = new Set();
        for (const p of permsRes.rows) {
            if (p.granted)
                granted.add(p.permission_id);
            else
                revoked.add(p.permission_id);
        }
        const permissions = Array.from(granted).filter(p => !revoked.has(p));
        req.user = {
            id: user.id,
            username: user.username,
            full_name: user.full_name,
            role_id: user.role_id,
            permissions
        };
        // Touch session (sliding window)
        pool_1.pool.query(`UPDATE sessions SET last_seen_at = NOW() WHERE token = $1`, [token])
            .catch(() => { });
        next();
    }
    catch (e) {
        console.error('authMiddleware error:', e);
        req.user = undefined;
        next();
    }
}
function requireAuth(req, res, next) {
    if (!req.user)
        throw (0, types_1.Unauthorized)();
    next();
}
function requirePermission(...perms) {
    return (req, res, next) => {
        if (!req.user)
            throw (0, types_1.Unauthorized)();
        const userPerms = new Set(req.user.permissions);
        const has = perms.every(p => userPerms.has(p));
        if (!has)
            throw (0, types_1.Forbidden)(`Ruxsat yo'q: ${perms.join(', ')}`);
        next();
    };
}
/** User needs at least one of the listed permissions. */
function requireAnyPermission(...perms) {
    return (req, res, next) => {
        if (!req.user)
            throw (0, types_1.Unauthorized)();
        const userPerms = new Set(req.user.permissions);
        if (req.user.role_id === 'owner')
            return next();
        const has = perms.some(p => userPerms.has(p));
        if (!has)
            throw (0, types_1.Forbidden)(`Ruxsat yo'q: ${perms.join(' yoki ')}`);
        next();
    };
}
function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.user)
            throw (0, types_1.Unauthorized)();
        if (!roles.includes(req.user.role_id))
            throw (0, types_1.Forbidden)();
        next();
    };
}
//# sourceMappingURL=auth.js.map