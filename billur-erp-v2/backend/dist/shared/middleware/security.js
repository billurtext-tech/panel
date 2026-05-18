"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cookieParser = cookieParser;
exports.securityHeaders = securityHeaders;
exports.corsMiddleware = corsMiddleware;
exports.clientIp = clientIp;
exports.rateLimit = rateLimit;
exports.auditLog = auditLog;
function cookieParser(req, res, next) {
    const cookies = {};
    const header = req.headers.cookie || '';
    header.split(';').forEach(p => {
        const idx = p.indexOf('=');
        if (idx === -1)
            return;
        const k = p.slice(0, idx).trim();
        const v = decodeURIComponent(p.slice(idx + 1).trim());
        if (k)
            cookies[k] = v;
    });
    req.cookies = cookies;
    next();
}
function securityHeaders(isProd) {
    return (req, res, next) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'DENY');
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(self)');
        res.setHeader('X-XSS-Protection', '0');
        if (isProd) {
            res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        }
        next();
    };
}
function corsMiddleware(allowedOrigins) {
    return (req, res, next) => {
        const origin = req.headers.origin;
        if (origin && allowedOrigins.includes(origin)) {
            res.setHeader('Access-Control-Allow-Origin', origin);
            res.setHeader('Access-Control-Allow-Credentials', 'true');
            res.setHeader('Vary', 'Origin');
        }
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-session-token');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
        res.setHeader('Access-Control-Max-Age', '600');
        if (req.method === 'OPTIONS') {
            res.status(204).end();
            return;
        }
        next();
    };
}
function clientIp(req) {
    const xf = req.headers['x-forwarded-for'];
    if (xf)
        return String(xf).split(',')[0].trim();
    return req.ip || req.socket.remoteAddress || 'unknown';
}
// Rate limiter (in-memory; production'da Redis bilan almashtirish kerak)
const buckets = new Map();
function rateLimit(maxPerWindow, windowMs) {
    return (req, res, next) => {
        const key = `${clientIp(req)}:${req.path}`;
        const now = Date.now();
        let b = buckets.get(key);
        if (!b || b.resetAt < now) {
            b = { count: 0, resetAt: now + windowMs };
            buckets.set(key, b);
        }
        b.count++;
        if (b.count > maxPerWindow) {
            res.status(429).json({ error: 'Juda ko\'p urinish, biroz kutib turing' });
            return;
        }
        next();
    };
}
// Audit log helper
const pool_1 = require("../database/pool");
async function auditLog(opts) {
    try {
        await pool_1.pool.query(`
      INSERT INTO audit_logs (event_type, user_id, username, resource_type, resource_id,
                              action, before_value, after_value, ip_address, user_agent, metadata)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    `, [
            opts.event_type, opts.user_id || null, opts.username || null,
            opts.resource_type || null, opts.resource_id || null, opts.action || null,
            opts.before_value ? JSON.stringify(opts.before_value) : null,
            opts.after_value ? JSON.stringify(opts.after_value) : null,
            opts.ip_address || null, opts.user_agent || null,
            opts.metadata ? JSON.stringify(opts.metadata) : null
        ]);
    }
    catch (e) {
        console.error('audit log error:', e);
    }
}
//# sourceMappingURL=security.js.map