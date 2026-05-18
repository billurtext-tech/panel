"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const pool_1 = require("./shared/database/pool");
const auth_1 = require("./shared/middleware/auth");
const security_1 = require("./shared/middleware/security");
const types_1 = require("./shared/types");
const auth_router_1 = __importDefault(require("./modules/auth/auth.router"));
const users_router_1 = __importDefault(require("./modules/users/users.router"));
const clients_router_1 = __importDefault(require("./modules/clients/clients.router"));
const orders_router_1 = __importDefault(require("./modules/orders/orders.router"));
const master_data_router_1 = __importDefault(require("./modules/master-data/master-data.router"));
const dashboard_router_1 = __importDefault(require("./modules/dashboard/dashboard.router"));
const production_router_1 = __importDefault(require("./modules/production/production.router"));
const quality_router_1 = __importDefault(require("./modules/quality/quality.router"));
const inventory_router_1 = __importDefault(require("./modules/inventory/inventory.router"));
const surplus_router_1 = __importDefault(require("./modules/surplus/surplus.router"));
const workers_router_1 = __importDefault(require("./modules/workers/workers.router"));
const qr_router_1 = __importDefault(require("./modules/qr/qr.router"));
const boxes_router_1 = __importDefault(require("./modules/boxes/boxes.router"));
const shipments_router_1 = __importDefault(require("./modules/shipments/shipments.router"));
const print_router_1 = __importDefault(require("./modules/print/print.router"));
const reports_router_1 = __importDefault(require("./modules/reports/reports.router"));
const audit_router_1 = __importDefault(require("./modules/audit/audit.router"));
const devices_router_1 = __importDefault(require("./modules/devices/devices.router"));
const scanning_router_1 = __importDefault(require("./modules/scanning/scanning.router"));
const payroll_router_1 = __importDefault(require("./modules/payroll/payroll.router"));
const worker_profile_router_1 = __importDefault(require("./modules/workers/worker-profile.router"));
const boxapp_router_1 = __importDefault(require("./modules/boxapp/boxapp.router"));
const box_production_router_1 = __importDefault(require("./modules/box-production/box-production.router"));
const attendance_router_1 = __importDefault(require("./modules/attendance/attendance.router"));
const files_router_1 = __importDefault(require("./modules/files/files.router"));
const sse_router_1 = __importDefault(require("./modules/sse/sse.router"));
const boxapp_service_1 = require("./modules/boxapp/boxapp.service");
const app = (0, express_1.default)();
const PORT = parseInt(process.env.PORT || '3001');
const isProd = process.env.NODE_ENV === 'production';
const allowedOrigins = (process.env.ALLOWED_ORIGINS ||
    'http://localhost:5173,http://localhost:3000')
    .split(',').map(s => s.trim()).filter(Boolean);
console.log('🌐 Allowed origins:', allowedOrigins);
app.set('trust proxy', 1);
app.use(express_1.default.json({ limit: '256kb' }));
app.use(express_1.default.urlencoded({ extended: true, limit: '64kb' }));
// Serve uploaded files (worker documents, etc.)
const node_path_1 = __importDefault(require("node:path"));
const UPLOAD_DIR = process.env.UPLOAD_DIR || node_path_1.default.resolve(process.cwd(), 'uploads');
app.use('/uploads', express_1.default.static(UPLOAD_DIR, {
    index: false,
    setHeaders: (res) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'private, max-age=3600');
    },
}));
app.use(security_1.cookieParser);
app.use((0, security_1.securityHeaders)(isProd));
app.use((0, security_1.corsMiddleware)(allowedOrigins));
app.use(auth_1.authMiddleware);
// Health check
app.get('/health', async (_req, res) => {
    try {
        await pool_1.pool.query('SELECT 1');
        res.json({ ok: true, env: isProd ? 'production' : 'dev' });
    }
    catch (e) {
        res.status(500).json({ ok: false, error: 'db' });
    }
});
// API routes
app.use('/api/auth', auth_router_1.default);
app.use('/api/users', users_router_1.default);
app.use('/api/clients', clients_router_1.default);
app.use('/api/orders', orders_router_1.default);
app.use('/api/master', master_data_router_1.default);
app.use('/api/dashboard', dashboard_router_1.default);
app.use('/api/production', production_router_1.default);
app.use('/api/quality', quality_router_1.default);
app.use('/api/inventory', inventory_router_1.default);
app.use('/api/surplus', surplus_router_1.default);
app.use('/api/workers', workers_router_1.default);
app.use('/api/qr', qr_router_1.default);
app.use('/api/boxes', boxes_router_1.default);
app.use('/api/shipments', shipments_router_1.default);
app.use('/api/print', print_router_1.default);
app.use('/api/reports', reports_router_1.default);
app.use('/api/audit', audit_router_1.default);
app.use('/api/devices', devices_router_1.default);
app.use('/api/scanning', scanning_router_1.default);
app.use('/api/payroll', payroll_router_1.default);
app.use('/api/worker-profile', worker_profile_router_1.default);
app.use('/api/boxapp', boxapp_router_1.default);
app.use('/api/box-production', box_production_router_1.default);
app.use('/api/attendance', attendance_router_1.default);
app.use('/api/files', files_router_1.default);
app.use('/api/sse', sse_router_1.default);
// 404
app.use('/api/*', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
});
// Error handler
app.use((err, _req, res, _next) => {
    if (err instanceof types_1.HttpError) {
        res.status(err.status).json({ error: err.message, code: err.code });
        return;
    }
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Server xatosi' });
});
app.listen(PORT, '0.0.0.0', () => {
    console.log('====================================');
    console.log('  BILLUR ERP API');
    console.log(`  Port: ${PORT}`);
    console.log(`  Env:  ${isProd ? 'production' : 'development'}`);
    console.log('====================================');
    // BoxApp sync worker — runs every minute
    if (process.env.BOXAPP_API_URL && process.env.BOXAPP_API_KEY) {
        console.log('  BoxApp sync: ENABLED');
        (0, boxapp_service_1.startBackgroundSync)(60_000);
    }
    else {
        console.log('  BoxApp sync: DISABLED (env not configured)');
    }
});
//# sourceMappingURL=index.js.map