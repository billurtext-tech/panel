"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pool = void 0;
exports.withTransaction = withTransaction;
const pg_1 = require("pg");
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
    console.error('❌ DATABASE_URL env o\'zgaruvchisi topilmadi!');
    process.exit(1);
}
exports.pool = new pg_1.Pool({
    connectionString,
    ssl: connectionString.includes('localhost') || connectionString.includes('127.0.0.1')
        ? false
        : { rejectUnauthorized: false },
    max: 15,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
});
exports.pool.on('error', (err) => console.error('PG pool error:', err));
// Helper for transactions
async function withTransaction(fn) {
    const client = await exports.pool.connect();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    }
    catch (e) {
        await client.query('ROLLBACK');
        throw e;
    }
    finally {
        client.release();
    }
}
//# sourceMappingURL=pool.js.map