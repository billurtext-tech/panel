"use strict";
// Order parsers for SET and Speka order types.
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseSetCode = parseSetCode;
exports.parseSetCodes = parseSetCodes;
exports.parseSpekaOrder = parseSpekaOrder;
const pool_1 = require("../../shared/database/pool");
const types_1 = require("../../shared/types");
async function parseSetCode(rawCode) {
    const code = (rawCode || '').trim().toUpperCase();
    const m = /^SET([0-9A-Z]+)-(.+)$/.exec(code);
    if (!m)
        throw (0, types_1.BadRequest)(`SET kod formati noto'g'ri: ${code}`);
    const setNumber = m[1];
    const rest = m[2]; // e.g. "LRTT-275-BLU-XL"
    // Try to match against existing models in the DB to find the longest model code
    // that's a prefix of `rest` (case-insensitive).
    const models = await pool_1.pool.query(`SELECT code FROM models ORDER BY length(code) DESC`);
    let matched = null;
    for (const row of models.rows) {
        const mc = String(row.code).toUpperCase();
        if (rest === mc) {
            matched = { model: mc, remainder: '' };
            break;
        }
        if (rest.startsWith(mc + '-')) {
            matched = { model: mc, remainder: rest.substring(mc.length + 1) };
            break;
        }
    }
    if (!matched) {
        // Fallback: split by last two hyphens — assume `..MODEL..-COLOR-SIZE`
        const parts = rest.split('-');
        if (parts.length < 3)
            throw (0, types_1.BadRequest)(`SET kod parse qilinmadi: ${code}`);
        const size = parts.pop();
        const color = parts.pop();
        const model = parts.join('-');
        return { set_number: setNumber, model_code: model, color_code: color, size_code: size, raw: rawCode };
    }
    // remainder is like "BLU-XL" — split last hyphen
    const parts = matched.remainder.split('-');
    if (parts.length < 2)
        throw (0, types_1.BadRequest)(`SET kod color va size aniqlanmadi: ${code}`);
    const size = parts.pop();
    const color = parts.join('-');
    return {
        set_number: setNumber,
        model_code: matched.model,
        color_code: color,
        size_code: size,
        raw: rawCode,
    };
}
/** Parse multiple SET codes (bulk-create scenario). */
async function parseSetCodes(rawCodes) {
    const out = [];
    for (const c of rawCodes) {
        out.push(await parseSetCode(c));
    }
    return out;
}
async function parseSpekaOrder(opts) {
    if (!Array.isArray(opts.items) || !opts.items.length) {
        throw (0, types_1.BadRequest)("Speka kamida 1 item bo'lishi kerak");
    }
    const out = {
        external_code: opts.speka_number ? `SPEKA-${opts.speka_number}` : `SPEKA-${Date.now()}`,
        items_to_create: [],
    };
    for (const item of opts.items) {
        const m = await pool_1.pool.query(`SELECT id FROM models WHERE UPPER(code) = $1`, [item.model_code.toUpperCase()]);
        if (!m.rows.length)
            throw (0, types_1.BadRequest)(`Model topilmadi: ${item.model_code}`);
        const c = await pool_1.pool.query(`SELECT id FROM colors WHERE UPPER(code) = $1 OR UPPER(name_uz) = $1`, [item.color_code.toUpperCase()]);
        if (!c.rows.length)
            throw (0, types_1.BadRequest)(`Rang topilmadi: ${item.color_code}`);
        for (const [sizeCode, qty] of Object.entries(item.size_breakdown || {})) {
            if (!qty || qty < 1)
                continue;
            const s = await pool_1.pool.query(`SELECT id FROM sizes WHERE UPPER(code) = $1`, [sizeCode.toUpperCase()]);
            if (!s.rows.length)
                throw (0, types_1.BadRequest)(`O'lcham topilmadi: ${sizeCode}`);
            out.items_to_create.push({
                model_id: m.rows[0].id,
                color_id: c.rows[0].id,
                size_id: s.rows[0].id,
                quantity: qty,
            });
        }
    }
    if (!out.items_to_create.length) {
        throw (0, types_1.BadRequest)("Speka'da hech bir size breakdown ko'rsatilmagan");
    }
    return out;
}
//# sourceMappingURL=orders.parsers.js.map