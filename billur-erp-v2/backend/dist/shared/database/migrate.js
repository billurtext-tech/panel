"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Migration runner — migrations/ papkasidagi .sql fayllarni tartib bilan ishga tushiradi
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const pool_1 = require("./pool");
const crypto_1 = require("../utils/crypto");
const MIGRATIONS_DIR = (0, node_path_1.join)(__dirname, '../../../migrations');
async function ensureMigrationsTable() {
    await pool_1.pool.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id          SERIAL PRIMARY KEY,
      filename    TEXT UNIQUE NOT NULL,
      applied_at  TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}
async function appliedMigrations() {
    const { rows } = await pool_1.pool.query(`SELECT filename FROM migrations`);
    return new Set(rows.map((r) => r.filename));
}
async function runMigration(filename) {
    const sql = (0, node_fs_1.readFileSync)((0, node_path_1.join)(MIGRATIONS_DIR, filename), 'utf-8');
    console.log(`▶ Migrating: ${filename}`);
    await pool_1.pool.query('BEGIN');
    try {
        await pool_1.pool.query(sql);
        await pool_1.pool.query(`INSERT INTO migrations (filename) VALUES ($1)`, [filename]);
        await pool_1.pool.query('COMMIT');
        console.log(`✓ Applied: ${filename}`);
    }
    catch (e) {
        await pool_1.pool.query('ROLLBACK');
        throw e;
    }
}
async function ensureAdminUser() {
    const { rows } = await pool_1.pool.query(`SELECT 1 FROM users WHERE username = 'admin' LIMIT 1`);
    if (rows.length > 0)
        return;
    const hash = await (0, crypto_1.hashPassword)('admin123');
    await pool_1.pool.query(`INSERT INTO users (username, password_hash, role_id, full_name)
     VALUES ($1, $2, $3, $4)`, ['admin', hash, 'owner', 'System Administrator']);
    console.log('✓ Default admin yaratildi: admin / admin123');
    console.log('⚠️  XAVFSIZLIK: birinchi loginda parolni o\'zgartiring!');
}
async function main() {
    await ensureMigrationsTable();
    const applied = await appliedMigrations();
    const files = (0, node_fs_1.readdirSync)(MIGRATIONS_DIR)
        .filter(f => f.endsWith('.sql'))
        .sort();
    let count = 0;
    for (const f of files) {
        if (!applied.has(f)) {
            await runMigration(f);
            count++;
        }
    }
    if (count === 0) {
        console.log('✓ Hamma migratsiyalar allaqachon qo\'llanilgan');
    }
    else {
        console.log(`✓ ${count} ta migratsiya qo'llanildi`);
    }
    await ensureAdminUser();
    await pool_1.pool.end();
}
main().catch((e) => {
    console.error('❌ Migration error:', e);
    process.exit(1);
});
//# sourceMappingURL=migrate.js.map